from rest_framework import serializers

from .models import Payment


class PaymentSerializer(serializers.ModelSerializer):
    """Ответ клиенту — статус платежа."""

    class Meta:
        model = Payment
        fields = ["id", "order", "provider", "status", "amount", "created_at"]
        read_only_fields = fields


class CreatePaymentSerializer(serializers.Serializer):
    """Вход для POST /payments/create/."""
    order_id = serializers.UUIDField()


class PaymentWebhookSerializer(serializers.Serializer):
    """
    Вход для POST /payments/webhook/.
    Форма подстроена под условный провайдер: провайдер шлёт id своего платежа и итоговый статус.
    """
    provider_payment_id = serializers.CharField(max_length=128)
    status = serializers.ChoiceField(choices=["succeeded", "failed"])
