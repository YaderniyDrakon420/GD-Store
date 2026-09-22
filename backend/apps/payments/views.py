import hashlib
import hmac
import logging
import uuid

from django.conf import settings
from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import permissions, status
from rest_framework.exceptions import PermissionDenied
from rest_framework.generics import CreateAPIView
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.store.models import Order
from apps.store.services import (
    expire_order_if_due, lock_order_participants, check_order_participants,
    beneficiary_already_owns_order_games,
)

from .models import Payment
from .services import apply_webhook, ensure_current_attempt
from .serializers import (
    CreatePaymentSerializer,
    PaymentSerializer,
    PaymentWebhookSerializer,
)
from .throttles import PaymentCreateThrottle


logger = logging.getLogger(__name__)


class CreatePaymentView(CreateAPIView):
    serializer_class = CreatePaymentSerializer
    permission_classes = [permissions.IsAuthenticated]
    throttle_classes = [PaymentCreateThrottle]

    def create(self, request, *args, **kwargs):
        del args, kwargs

        from apps.studio.commerce import require_test_mode
        require_test_mode()

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        order_id = serializer.validated_data["order_id"]

        reference = get_object_or_404(Order, id=order_id, user=request.user)
        with transaction.atomic():
            lock_order_participants(reference.user_id, reference.recipient_id)
            order = get_object_or_404(
                Order.objects.select_for_update(),
                id=order_id,
                user=request.user,
            )

            check_order_participants(order, reference.user_id, reference.recipient_id)
            if expire_order_if_due(order):
                return Response(
                    {"detail": "Срок оплаты заказа истёк."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if order.status != Order.STATUS_PENDING:
                return Response(
                    {
                        "detail": (
                            "Оплатить можно только заказ "
                            "в статусе pending."
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if beneficiary_already_owns_order_games(order):
                return Response(
                    {"detail": "Получатель уже владеет игрой из этого заказа. "
                               "Отмените заказ и оформите оставшиеся игры отдельно."},
                    status=status.HTTP_409_CONFLICT,
                )

            payment, created = Payment.objects.get_or_create(
                order=order,
                defaults={
                    "amount": order.total,
                    "provider": "educational",
                },
            )

            if not created:
                payment = Payment.objects.select_for_update().get(
                    pk=payment.pk
                )

            if payment.status == Payment.STATUS_SUCCEEDED:
                return Response(
                    {"detail": "Заказ уже оплачен."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if payment.status == Payment.STATUS_REFUNDED:
                return Response(
                    {
                        "detail": (
                            "Платёж по этому заказу "
                            "уже был возвращён."
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if payment.attempts.filter(review_required=True).exists():
                return Response(
                    {"detail": "Платёж требует сверки. Новая попытка недоступна."},
                    status=status.HTTP_409_CONFLICT,
                )

            # До смены текущего ID сохраняем предыдущую попытку и её результат.
            ensure_current_attempt(payment)

            # Повторный запрос должен вернуть действующую попытку без изменений.
            # Пустой ID возможен у старых записей, созданных вне этого endpoint.
            if (
                created
                or payment.status == Payment.STATUS_FAILED
                or not payment.provider_payment_id
            ):
                payment.status = Payment.STATUS_CREATED
                payment.amount = order.total
                payment.provider_payment_id = uuid.uuid4().hex
                payment.raw_payload = {}
                payment.save()
                ensure_current_attempt(payment)

        logger.info(
            "Payment %s checkout returned for order %s to user %s",
            payment.id,
            order.id,
            request.user.id,
        )

        data = PaymentSerializer(payment).data

        # This endpoint records a legacy test attempt; the storefront uses the
        # signed studio checkout command. Never redirect to a fictitious provider.
        data["checkout_url"] = None
        data["test_mode"] = True

        return Response(
            data,
            status=status.HTTP_201_CREATED,
        )


class PaymentWebhookView(APIView):
    permission_classes = [permissions.AllowAny]

    def _check_signature(self, request):
        secret = getattr(settings, "PAYMENT_WEBHOOK_SECRET", "")

        if not secret or not secret.strip():
            logger.error("Payment webhook rejected: secret is not configured")
            raise PermissionDenied("Приём уведомлений об оплате отключён.")

        signature = request.headers.get("X-Signature", "")

        if (
            len(signature) != 64
            or any(char not in "0123456789abcdefABCDEF" for char in signature)
        ):
            raise PermissionDenied("Отсутствует или неверна подпись webhook'а.")

        expected = hmac.new(
            secret.encode("utf-8"),
            request.body,
            hashlib.sha256,
        ).hexdigest()

        if not hmac.compare_digest(signature.lower(), expected):
            logger.warning("Payment webhook rejected: bad signature")
            raise PermissionDenied("Неверная подпись webhook'а.")

    def post(self, request):
        self._check_signature(request)

        serializer = PaymentWebhookSerializer(
            data=request.data
        )
        serializer.is_valid(raise_exception=True)

        provider_payment_id = (
            serializer.validated_data[
                "provider_payment_id"
            ]
        )

        webhook_status = serializer.validated_data[
            "status"
        ]

        apply_webhook(provider_payment_id, webhook_status, request.data)
        return Response(status=status.HTTP_200_OK)
