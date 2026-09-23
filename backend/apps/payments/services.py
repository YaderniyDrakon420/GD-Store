"""Payment transitions. Lock order: sorted users -> Order -> Payment -> PaymentAttempt."""
import logging

from django.db import transaction
from django.shortcuts import get_object_or_404

from apps.library.models import LibraryEntry
from apps.store.models import Order
from apps.store.services import (
    expire_order_if_due, lock_order_participants, check_order_participants,
    beneficiary_already_owns_order_games,
)
from .models import Payment, PaymentAttempt

logger = logging.getLogger(__name__)
TERMINAL = (Payment.STATUS_SUCCEEDED, Payment.STATUS_REFUNDED)


def ensure_current_attempt(payment):
    """Caller holds the Order and Payment locks; preserve legacy current IDs."""
    if not payment.provider_payment_id:
        return None
    attempt, _ = PaymentAttempt.objects.get_or_create(
        provider_payment_id=payment.provider_payment_id,
        defaults={
            "payment": payment,
            "provider": payment.provider,
            "amount": payment.amount,
            "status": payment.status,
            "raw_payload": payment.raw_payload,
        },
    )
    if attempt.payment_id != payment.pk:
        # Never attach an ambiguous provider identifier to another order.
        raise ValueError("Provider payment ID belongs to another payment")
    return attempt


def apply_webhook(provider_payment_id, incoming_status, payload):
    reference = get_object_or_404(
        PaymentAttempt.objects.values(
            "id", "payment_id", "payment__order_id",
            "payment__order__user_id", "payment__order__recipient_id",
        ),
        provider_payment_id=provider_payment_id,
    )
    with transaction.atomic():
        user_id = reference["payment__order__user_id"]
        recipient_id = reference["payment__order__recipient_id"]
        lock_order_participants(user_id, recipient_id)
        order = get_object_or_404(
            Order.objects.select_for_update(), pk=reference["payment__order_id"],
        )
        check_order_participants(order, user_id, recipient_id)
        payment = get_object_or_404(
            Payment.objects.select_for_update(),
            pk=reference["payment_id"], order_id=order.pk,
        )
        attempt = get_object_or_404(
            PaymentAttempt.objects.select_for_update(),
            pk=reference["id"], payment_id=payment.pk,
            provider_payment_id=provider_payment_id,
        )
        # Even a duplicate failed event may arrive after the reservation TTL.
        expire_order_if_due(order)
        if attempt.status in TERMINAL:
            return

        if incoming_status == Payment.STATUS_FAILED:
            if attempt.status == Payment.STATUS_FAILED:
                return
            attempt.status = Payment.STATUS_FAILED
            attempt.raw_payload = payload
            attempt.save(update_fields=["status", "raw_payload", "updated_at"])
            # An old attempt cannot fail the new active attempt or a paid order.
            if (payment.provider_payment_id == attempt.provider_payment_id
                    and payment.status not in TERMINAL):
                payment.status = Payment.STATUS_FAILED
                payment.raw_payload = payload
                payment.save(update_fields=["status", "raw_payload", "updated_at"])
            logger.warning("Payment attempt %s failed for order %s", attempt.pk, order.pk)
            return

        # Financial success remains success even if fulfillment is impossible.
        attempt.status = Payment.STATUS_SUCCEEDED
        attempt.raw_payload = payload

        if payment.status in TERMINAL:
            reason = "additional_success"
        elif order.status != Order.STATUS_PENDING:
            reason = "order_not_payable"
        elif attempt.amount != order.total:
            reason = "amount_mismatch"
        elif beneficiary_already_owns_order_games(order):
            reason = "already_owned"
        else:
            reason = ""

        attempt.review_required = bool(reason)
        attempt.review_reason = reason
        attempt.save(update_fields=[
            "status", "raw_payload", "review_required", "review_reason", "updated_at",
        ])
        if payment.status not in TERMINAL:
            payment.status = Payment.STATUS_SUCCEEDED
            payment.provider_payment_id = attempt.provider_payment_id
            payment.amount = attempt.amount
            payment.raw_payload = payload
            payment.save(update_fields=[
                "status", "provider_payment_id", "amount", "raw_payload", "updated_at",
            ])
        if reason:
            logger.error("Payment attempt %s requires review: %s", attempt.pk, reason)
            return

        order.status = Order.STATUS_PAID
        order.save(update_fields=["status"])
        beneficiary = order.beneficiary
        for item in order.items.all():
            LibraryEntry.objects.get_or_create(user=beneficiary, game_id=item.game_id)
        logger.info("Payment attempt %s fulfilled order %s", attempt.pk, order.pk)
