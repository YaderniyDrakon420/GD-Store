"""Order closure and promo reservations; caller locks Order before PromoCode."""
from django.contrib.auth import get_user_model
from django.http import Http404
from django.db import transaction
from django.db.models import F, Q
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .models import Order, PromoCode


def close_pending_order(order, new_status):
    """Caller must hold the Order lock inside atomic(). Release at most once."""
    if new_status not in (Order.STATUS_CANCELLED, Order.STATUS_EXPIRED):
        raise ValueError("Unsupported order closure")
    if order.status != Order.STATUS_PENDING:
        return False
    if order.promo_code_id is not None:
        changed = PromoCode.objects.filter(
            pk=order.promo_code_id, times_used__gt=0,
        ).update(times_used=F("times_used") - 1)
        if changed != 1:
            raise ValidationError("Счётчик промокода требует сверки. Заказ не изменён.")
    order.status = new_status
    order.save(update_fields=["status"])
    return True


def expire_order_if_due(order, now=None):
    now = now if now is not None else timezone.now()
    if (order.status != Order.STATUS_PENDING or order.expires_at is None
            or order.expires_at > now):
        return False
    return close_pending_order(order, Order.STATUS_EXPIRED)


def expire_pending_orders(promo_id=None):
    """Shared by scheduled command and on-demand promo validation.

    No PromoCode lock is held while acquiring an existing Order lock.
    Fetch a batch completely before writes (no parallel ODBC cursors).
    """
    now = timezone.now()
    count = 0
    last_pk = None
    while True:
        candidates = Order.objects.filter(
            status=Order.STATUS_PENDING, expires_at__lte=now,
        )
        if promo_id is not None:
            candidates = candidates.filter(promo_code_id=promo_id)
        if last_pk is not None:
            candidates = candidates.filter(pk__gt=last_pk)
        ids = list(candidates.order_by("pk").values_list("pk", flat=True)[:200])
        if not ids:
            break
        for order_id in ids:
            with transaction.atomic():
                order = Order.objects.select_for_update().filter(pk=order_id).first()
                if order is not None and expire_order_if_due(order, now):
                    count += 1
        last_pk = ids[-1]
    return count


def lock_order_participants(user_id, recipient_id):
    """Caller is in atomic(). Always lock both parties in DB primary-key order.

    Shared by checkout, payment creation, fulfillment and refund. Locking only
    the beneficiary would deadlock two simultaneous reciprocal gifts on FK writes.
    """
    ids = {user_id, recipient_id or user_id}
    locked = list(get_user_model().objects.select_for_update().filter(
        pk__in=ids,
    ).order_by("pk").values_list("pk", flat=True))
    if set(locked) != ids:
        raise Http404("Участник заказа больше недоступен.")


def check_order_participants(order, user_id, recipient_id):
    # The reference was read before locking; reject an unexpected reassignment.
    if order.user_id != user_id or order.recipient_id != recipient_id:
        raise ValidationError("Участники заказа изменились. Повторите запрос.")


def pending_order_contains_games(beneficiary_id, game_ids):
    return Order.objects.filter(
        Q(recipient_id=beneficiary_id)
        | Q(user_id=beneficiary_id, recipient__isnull=True),
        Q(expires_at__isnull=True) | Q(expires_at__gt=timezone.now()),
        status=Order.STATUS_PENDING,
        items__game_id__in=game_ids,
    ).exists()


def beneficiary_already_owns_order_games(order):
    from apps.library.models import LibraryEntry
    return LibraryEntry.objects.filter(
        user_id=order.recipient_id or order.user_id,
        game_id__in=order.items.values_list("game_id", flat=True),
    ).exists()
