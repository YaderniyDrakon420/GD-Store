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
        mode = request.data.get("mode")
        result = {}
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
                login(request, user, backend="django.contrib.auth.backends.ModelBackend")
                result["recovery"] = code
            elif mode in ("login", "reset"):
                value = text(request.data.get("login"), 254)
                users = list(User.objects.filter(Q(username__iexact=value) | Q(email__iexact=value))[:2])
                user = users[0] if len(users) == 1 else None
                if mode == "login":
                    user = authenticate(request, username=user.username if user else value,
                                        password=request.data.get("password", ""))
                    if not user:
                        raise ValidationError("Неверный логин или пароль, либо профиль заблокирован.")
                    login(request, user)
                else:
                    recovery = text(request.data.get("recovery", ""), 128).upper()
                    if not user or not user.is_active or not check_password(recovery, profile(user).recovery_hash):
                        raise ValidationError("Неверный логин или код восстановления.")
                    user.set_password(password(request.data.get("password"), user))
                    user.save(update_fields=["password"])
                    # A saved recovery key remains usable; password changes invalidate sessions.
                    logout(request)
            else:
                raise ValidationError("Неизвестное действие входа.")
        return Response({**result, "csrf": get_token(request)})
