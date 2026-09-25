import secrets
import re

from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.hashers import make_password, check_password
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email
from django.db import transaction
from django.db.models import Q
from django.middleware.csrf import get_token
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView

from apps.accounts.models import User
from .common import lock_mutations, profile, text
from .presence import clear_session_presence
from .models import PresenceSession


class AuthThrottle(AnonRateThrottle):
    rate = "15/min"


def password(value, user):
    if not isinstance(value, str) or not 8 <= len(value) <= 128:
        raise ValidationError("Пароль должен содержать от 8 до 128 символов.")
    try:
        validate_password(value, user)
    except DjangoValidationError as exc:
        raise ValidationError(exc.messages) from exc
    return value


@method_decorator(csrf_protect, name="dispatch")
class AccountView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [AuthThrottle]

    def post(self, request):
        if not isinstance(request.data, dict):
            raise ValidationError("Передайте объект действия.")
        mode = request.data.get("mode")
        result = {}
        if mode == "login":
            value = text(request.data.get("login"), 254)
            users = list(User.objects.filter(Q(username__iexact=value) | Q(email__iexact=value))[:2])
            username = users[0].username if len(users) == 1 else value
            # Authentication runs before the login transaction, so rejected
            # attempts still count against the shared per-account rate limit.
            user = authenticate(request, username=username, password=request.data.get("password", ""), otp=request.data.get("otp", ""))
            if not user:
                raise ValidationError("Неверный логин, пароль или код 2FA, либо вход временно ограничен.")
            with transaction.atomic():
                lock_mutations()
                clear_session_presence(None, request, request.user)
                login(request, user)
                from .community_features import sync_achievements
                sync_achievements(user)
            return Response({"csrf": get_token(request)}, headers={"Cache-Control": "no-store"})
        with transaction.atomic():
            lock_mutations()
            if mode == "logout":
                logout(request)
            elif mode == "register":
                handle = text(request.data.get("handle"), 32).lower()
                if not re.fullmatch(r"[a-z0-9_]{3,32}", handle):
                    raise ValidationError("Логин: 3–32 латинских буквы, цифры или подчёркивания.")
                email = text(request.data.get("email"), 254).lower()
                try:
                    validate_email(email)
                except DjangoValidationError as exc:
                    raise ValidationError("Введите корректный email.") from exc
                if User.objects.filter(Q(username__iexact=handle) | Q(email__iexact=email)).exists():
                    raise ValidationError("Этот логин или email уже занят.")
                user = User(username=handle, email=email, display_name=text(request.data.get("name"), 40))
                user.set_password(password(request.data.get("password"), user))
                user.save()
                code = secrets.token_hex(18).upper()
                code = "-".join(code[i:i + 6] for i in range(0, len(code), 6))
                p = profile(user)
                p.recovery_hash = make_password(code)
                p.save(update_fields=["recovery_hash"])
                clear_session_presence(None, request, request.user)
                login(request, user, backend="apps.studio.security.TwoFactorBackend")
                result["recovery"] = code
            elif mode == "reset":
                value = text(request.data.get("login"), 254)
                users = list(User.objects.filter(Q(username__iexact=value) | Q(email__iexact=value))[:2])
                user = users[0] if len(users) == 1 else None
                recovery = text(request.data.get("recovery", ""), 128).upper()
                if not user or not user.is_active or not check_password(recovery, profile(user).recovery_hash):
                    raise ValidationError("Неверный логин или код восстановления.")
                from .security import verify_second_factor, revoke_devices
                if not verify_second_factor(user, request.data.get("otp", "")):
                    raise ValidationError("Введите код 2FA или резервный код.")
                user.set_password(password(request.data.get("password"), user))
                user.save(update_fields=["password"])
                PresenceSession.objects.filter(user=user).delete()
                revoke_devices(user)
                # A saved recovery key remains usable; password changes invalidate sessions.
                logout(request)
            else:
                raise ValidationError("Неизвестное действие входа.")
        return Response({**result, "csrf": get_token(request)})
