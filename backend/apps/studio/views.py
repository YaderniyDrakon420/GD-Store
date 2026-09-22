import hashlib
import json
from django.middleware.csrf import get_token
from django.db import transaction
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.exceptions import ValidationError, PermissionDenied
from rest_framework.throttling import UserRateThrottle
from rest_framework.response import Response
from rest_framework.views import APIView

from .snapshot import snapshot
from .common import identifier, lock_mutations
from .commands import execute
from .commerce import quote
from .models import Operation


class SnapshotView(APIView):
    permission_classes = [AllowAny]

    @transaction.atomic
    def get(self, request):
        response = Response({**snapshot(request.user), "csrf": get_token(request)})
        response["Cache-Control"] = "no-store"
        return response


class MutationThrottle(UserRateThrottle):
    rate = "120/min"


class QuoteView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [MutationThrottle]

    def post(self, request):
        if request.headers.get("X-Store-User") and request.headers["X-Store-User"] != str(request.user.pk):
            raise PermissionDenied("Аккаунт изменился. Обновите страницу.")
        return Response(quote(request.user, request.data))


class CommandView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [MutationThrottle]

    def post(self, request):
        key = identifier(request.headers.get("Idempotency-Key"))
        if request.headers.get("X-Store-User") and request.headers["X-Store-User"] != str(request.user.pk):
            raise PermissionDenied("Аккаунт изменился. Обновите страницу.")
        action = request.data
        if not isinstance(action, dict) or not isinstance(action.get("type"), str):
            raise ValidationError("Передайте объект действия с полем type.")
        fingerprint = hashlib.sha256(json.dumps(action, sort_keys=True, ensure_ascii=True).encode()).hexdigest()
        with transaction.atomic():
            lock_mutations()
            request.user.refresh_from_db()
            if not request.user.is_active:
                raise ValidationError("Профиль заблокирован.")
            receipt = Operation.objects.filter(user=request.user, key=key).first()
            if receipt:
                if receipt.fingerprint != fingerprint:
                    raise ValidationError("Этот ключ запроса уже использован для другого действия.")
                result = receipt.result
            else:
                result = execute(request.user, action)
                Operation.objects.create(user=request.user, key=key, fingerprint=fingerprint, result=result)
            payload = {**snapshot(request.user), "result": result, "csrf": get_token(request)}
        response = Response(payload)
        response["Cache-Control"] = "no-store"
        return response
