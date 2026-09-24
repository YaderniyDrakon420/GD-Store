"""Email tokens, TOTP (RFC 6238) and revocable browser sessions."""
import base64
import hashlib
import hmac
import secrets
import struct
import time
from datetime import timedelta
from urllib.parse import quote, urlencode

from cryptography.fernet import Fernet
from django import forms
from django.conf import settings
from django.contrib import admin
from django.contrib.admin.forms import AdminAuthenticationForm
from django.contrib.auth import authenticate, update_session_auth_hash
from django.contrib.auth.backends import ModelBackend
from django.contrib.auth.signals import user_logged_in, user_logged_out
from django.contrib.sessions.models import Session
from django.core.mail import send_mail
from django.db import transaction
from django.db.models import Q
from django.dispatch import receiver
from django.middleware.csrf import get_token
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.serializers import TokenRefreshSerializer

from apps.accounts.models import User
from .common import identifier, lock_mutations, text
from .models import AccountSecurity, AccountToken, AccountDevice, PresenceSession, AuthenticationWindow


def cipher():
    key = hashlib.sha256((settings.SECRET_KEY + ":gdstore.totp.v1").encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def totp(secret, counter, digits=6):
    digest = hmac.new(base64.b32decode(secret), struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 15
    value = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7fffffff
    return str(value % 10 ** digits).zfill(digits)


class SecureTokenRefreshSerializer(TokenRefreshSerializer):
    def validate(self, attrs):
        JWTAuthentication().get_user(self.token_class(attrs["refresh"]))
        return super().validate(attrs)


def verify_second_factor(user, code, *, pending=False):
    """Caller holds MutationLock. A successful code can be used only once."""
    security = AccountSecurity.objects.filter(user=user).first()
    if not security or (not security.enabled and not pending):
        return not pending
    if not isinstance(code, str) or len(code) > 128:
        return False
    code = code.strip().replace(" ", "")
    digest = hashlib.sha256(code.encode()).hexdigest()
    if security.enabled and digest in security.backup_hashes:
        security.backup_hashes.remove(digest)
        security.save(update_fields=["backup_hashes"])
        return True
    if not security.secret or not code.isdigit() or len(code) != 6:
        return False
    secret = cipher().decrypt(security.secret.encode()).decode()
    counter = int(time.time()) // 30
    for step in [counter - 1, counter, counter + 1]:
        if step > security.last_counter and hmac.compare_digest(totp(secret, step), code):
            security.last_counter = step
            security.save(update_fields=["last_counter"])
            return True
    return False


class TwoFactorBackend(ModelBackend):
    def authenticate(self, request, username=None, password=None, otp=None, **kwargs):
        identity = hashlib.sha256(str(username or kwargs.get("username", "")).lower().encode()).hexdigest()
        with transaction.atomic():
            lock_mutations()
            window, _ = AuthenticationWindow.objects.get_or_create(identity=identity, defaults={"started_at": timezone.now()})
            if window.started_at < timezone.now() - timedelta(minutes=1):
                window.count, window.started_at = 0, timezone.now()
            if window.count >= 10:
                return None
            window.count += 1
            window.save(update_fields=["count", "started_at"])
        user = super().authenticate(request, username=username, password=password, **kwargs)
        if user is None:
            return None
        if otp is None and request is not None:
            source = getattr(request, "data", None) or request.POST
            otp = source.get("otp", "")
        with transaction.atomic():
            lock_mutations()
            if not verify_second_factor(user, otp or ""):
                return None
        return user


class TwoFactorAdminForm(AdminAuthenticationForm):
    otp = forms.CharField(label="Код 2FA (если включён)", required=False, widget=forms.TextInput(attrs={"autocomplete": "one-time-code"}))


admin.site.login_form = TwoFactorAdminForm
admin.site.login_template = "admin/two_factor_login.html"


def device_label(request):
    agent = request.META.get("HTTP_USER_AGENT", "")
    browser = next((label for marker, label in [("Edg/", "Edge"), ("Firefox/", "Firefox"), ("Chrome/", "Chrome"), ("Safari/", "Safari")] if marker in agent), "Браузер")
    os = next((name for name in ["Android", "iPhone", "Windows", "Macintosh", "Linux"] if name in agent), "устройство")
    return browser + " · " + os


@receiver(user_logged_in, dispatch_uid="gdstore_device_login")
def register_device(sender, request, user, **kwargs):
    if request and request.session.session_key:
        AccountDevice.objects.update_or_create(session_key=request.session.session_key, defaults={"user": user, "label": device_label(request), "last_seen": timezone.now()})


@receiver(user_logged_out, dispatch_uid="gdstore_device_logout")
def remove_device(sender, request, **kwargs):
    if request and request.session.session_key:
        AccountDevice.objects.filter(session_key=request.session.session_key).delete()


def revoke_devices(user, keep=None):
    keys = list(AccountDevice.objects.filter(user=user).exclude(session_key=keep).values_list("session_key", flat=True))
    # Includes pre-upgrade browser sessions, without exposing session keys to UI.
    for session in Session.objects.filter(expire_date__gt=timezone.now()).exclude(session_key=keep):
        if session.get_decoded().get("_auth_user_id") == str(user.pk):
            keys.append(session.session_key)
    Session.objects.filter(session_key__in=keys).delete()
    AccountDevice.objects.filter(session_key__in=keys).delete()
    PresenceSession.objects.filter(user=user).delete()


def security_data(request):
    user = request.user
    if not user.is_authenticated:
        raise PermissionDenied("Войдите в аккаунт.")
    security = AccountSecurity.objects.filter(user=user).first()
    key = request.session.session_key
    live = set(Session.objects.filter(expire_date__gt=timezone.now()).values_list("session_key", flat=True))
    return {"email": user.email, "emailVerified": user.is_email_verified,
            "twoFactor": bool(security and security.enabled), "backupCodesLeft": len(security.backup_hashes) if security else 0,
            "mailMode": "local" if settings.EMAIL_BACKEND.endswith("filebased.EmailBackend") else "smtp",
            "devices": [{"id": str(d.pk), "label": d.label, "current": d.session_key == key, "at": d.last_seen.isoformat()}
                        for d in AccountDevice.objects.filter(user=user).order_by("-last_seen") if d.session_key in live or d.session_key == key]}


def issue_email(user, purpose):
    if AccountToken.objects.filter(user=user, purpose=purpose, created_at__gt=timezone.now() - timedelta(minutes=1)).exists():
        return
    token = secrets.token_urlsafe(32)
    digest = hashlib.sha256(token.encode()).hexdigest()
    AccountToken.objects.filter(user=user, purpose=purpose).delete()
    AccountToken.objects.create(digest=digest, user=user, purpose=purpose, email=user.email, expires_at=timezone.now() + timedelta(minutes=30))
    url = settings.FRONTEND_URL.rstrip("/") + "/account-action?" + urlencode({"purpose": purpose, "token": token})
    title = "Подтвердите почту GD Store" if purpose == "verify" else "Восстановление доступа к GD Store"
    send_mail(title, f"{title}\n\n{url}\n\nСсылка действует 30 минут и используется один раз. Если вы не отправляли запрос, просто проигнорируйте это письмо.", settings.DEFAULT_FROM_EMAIL, [user.email])


class SecurityThrottle(SimpleRateThrottle):
    rate = "10/min"
    scope = "account_security"

    def get_cache_key(self, request, view):
        identity = str(request.user.pk) if request.user.is_authenticated else self.get_ident(request)
        return self.cache_format % {"scope": self.scope, "ident": identity}


@method_decorator(csrf_protect, name="dispatch")
class SecurityView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [SecurityThrottle]

    def get(self, request):
        return Response(security_data(request), headers={"Cache-Control": "no-store"})

    def post(self, request):
        if not isinstance(request.data, dict):
            raise ValidationError("Передайте объект действия.")
        mode = request.data.get("mode")
        result = {}
        with transaction.atomic():
            lock_mutations()
            if mode == "request-reset":
                value = text(request.data.get("login"), 254)
                users = list(User.objects.filter(Q(username__iexact=value) | Q(email__iexact=value), is_active=True)[:2])
                if len(users) == 1 and users[0].email:
                    issue_email(users[0], "reset")
                # Same response for unknown addresses; never return email tokens.
                result = {"message": "Если аккаунт найден, письмо с инструкцией отправлено."}
            elif mode in ["verify-email", "reset-email"]:
                raw = text(request.data.get("token"), 128)
                token = AccountToken.objects.filter(digest=hashlib.sha256(raw.encode()).hexdigest(), purpose="verify" if mode == "verify-email" else "reset", expires_at__gt=timezone.now()).select_related("user").first()
                if not token or not token.user.is_active or token.email != token.user.email:
                    raise ValidationError("Ссылка недействительна или истекла. Запросите новое письмо.")
                user = token.user
                if mode == "verify-email":
                    user.is_email_verified = True
                    user.save(update_fields=["is_email_verified"])
                else:
                    from .auth import password
                    if not verify_second_factor(user, request.data.get("otp", "")):
                        raise ValidationError("Введите действующий код 2FA или резервный код.")
                    user.set_password(password(request.data.get("password"), user))
                    user.save(update_fields=["password"])
                    revoke_devices(user)
                    AccountToken.objects.filter(user=user, purpose="reset").delete()
                token.delete()
                result = {"ok": True}
            else:
                if not request.user.is_authenticated or not request.user.is_active:
                    raise PermissionDenied("Войдите в аккаунт.")
                user = request.user
                if mode == "send-verification":
                    if user.is_email_verified:
                        raise ValidationError("Почта уже подтверждена.")
                    issue_email(user, "verify")
                else:
                    if not isinstance(request.data.get("password"), str) or not user.check_password(request.data.get("password", "")):
                        raise ValidationError("Неверный текущий пароль.")
                    security, _ = AccountSecurity.objects.get_or_create(user=user)
                    if mode == "totp-setup":
                        if security.enabled:
                            raise ValidationError("Двухфакторный вход уже включён.")
                        secret = base64.b32encode(secrets.token_bytes(20)).decode()
                        security.secret = cipher().encrypt(secret.encode()).decode()
                        security.last_counter = -1
                        security.save(update_fields=["secret", "last_counter"])
                        request.session["totp_setup_until"] = int(time.time()) + 600
                        result = {"secret": secret, "uri": "otpauth://totp/" + quote("GD Store:" + user.username) + "?" + urlencode({"secret": secret, "issuer": "GD Store"})}
                    elif mode == "totp-enable":
                        if security.enabled or request.session.get("totp_setup_until", 0) < time.time() or not verify_second_factor(user, request.data.get("otp", ""), pending=True):
                            raise ValidationError("Проверьте код приложения или начните настройку заново.")
                        security.refresh_from_db()
                        codes = [secrets.token_hex(8) for _ in range(8)]
                        security.enabled, security.backup_hashes = True, [hashlib.sha256(c.encode()).hexdigest() for c in codes]
                        security.save(update_fields=["enabled", "backup_hashes"])
                        # Rotate the password hash to invalidate already issued JWTs too.
                        user.set_password(request.data["password"])
                        user.save(update_fields=["password"])
                        update_session_auth_hash(request, user)
                        revoke_devices(user, request.session.session_key)
                        register_device(None, request, user)
                        request.session.pop("totp_setup_until", None)
                        result = {"backupCodes": codes}
                    elif mode == "totp-disable":
                        if not security.enabled or not verify_second_factor(user, request.data.get("otp", "")):
                            raise ValidationError("Введите код 2FA или резервный код.")
                        security.enabled, security.secret, security.backup_hashes = False, "", []
                        security.save(update_fields=["enabled", "secret", "backup_hashes"])
                    elif mode in ["revoke-device", "revoke-others"]:
                        if not verify_second_factor(user, request.data.get("otp", "")):
                            raise ValidationError("Введите код 2FA или резервный код.")
                        if mode == "revoke-others":
                            user.set_password(request.data["password"])
                            user.save(update_fields=["password"])
                            update_session_auth_hash(request, user)
                            revoke_devices(user, request.session.session_key)
                            register_device(None, request, user)
                        else:
                            device = AccountDevice.objects.filter(pk=identifier(request.data.get("device")), user=user).first()
                            if not device or device.session_key == request.session.session_key:
                                raise ValidationError("Выберите другой сеанс.")
                            Session.objects.filter(session_key=device.session_key).delete()
                            PresenceSession.objects.filter(session_hash=hashlib.sha256(device.session_key.encode()).hexdigest()).delete()
                            device.delete()
                    else:
                        raise ValidationError("Неизвестное действие безопасности.")
        return Response({**result, "csrf": get_token(request)}, headers={"Cache-Control": "no-store"})
