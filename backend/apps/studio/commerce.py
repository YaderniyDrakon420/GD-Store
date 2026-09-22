"""Educational purchases only. Amounts, ownership and receipts are server-owned."""
from decimal import Decimal, InvalidOperation
import uuid

from django.conf import settings
from django.core import signing
from django.db.models import F
from rest_framework.exceptions import ValidationError, PermissionDenied

from apps.accounts.models import User
from apps.catalog.models import Game
from apps.library.models import LibraryEntry
from apps.payments.models import Payment, PaymentAttempt
from apps.store.models import CartItem, Wishlist, PromoCode, Order, OrderItem
from apps.store.services import lock_order_participants, pending_order_contains_games
from .common import get_game, get_user, friends, text, choice, profile, create, notify
from .models import WalletEntry, PointsEntry, Record

SALT = "gdstore.studio.checkout.v1"
CENT = Decimal("0.01")


def require_test_mode():
    if not settings.PAYMENT_TEST_MODE:
        raise PermissionDenied("Учебные платежи выключены на сервере. Нужен PAYMENT_TEST_MODE=1.")


def calculate(user, action, *, locked=False):
    recipient = get_user(action["recipient"]) if action.get("recipient") else user
    if recipient != user and not friends(user, recipient):
        raise ValidationError("Подарок можно отправить только активному другу.")
    if locked:
        lock_order_participants(user.pk, recipient.pk)
        # Refresh the balance after acquiring the shared commerce user locks.
        user.refresh_from_db()
        recipient.refresh_from_db()
        if not user.is_active or not recipient.is_active:
            raise PermissionDenied("Участник покупки заблокирован.")
    rows = list(CartItem.objects.filter(user=user).select_related("game").order_by("pk"))
    if not rows:
        raise ValidationError("Корзина пуста.")
    ids = [i.game_id for i in rows]
    if locked:
        locked_games = {g.pk: g for g in Game.objects.select_for_update().filter(pk__in=ids).order_by("pk")}
        for row in rows:
            row.game = locked_games[row.game_id]
    if any(not i.game.is_published for i in rows):
        raise ValidationError("В корзине есть недоступная игра. Удалите её перед покупкой.")
    if LibraryEntry.objects.filter(user=recipient, game_id__in=ids).exists():
        raise ValidationError("У получателя уже есть игра из корзины. Удалите её перед покупкой.")
    if pending_order_contains_games(recipient.pk, ids):
        raise ValidationError("На эту игру уже есть ожидающий оплаты заказ. Отмените его в истории заказов.")
    code = text(action.get("promo", ""), 32, required=False).upper()
    promos = PromoCode.objects.select_for_update() if locked else PromoCode.objects
    promo = promos.filter(code__iexact=code).first() if code else None
    if code and (not promo or not promo.is_valid()):
        raise ValidationError("Промокод недействителен или исчерпан.")
    subtotal = sum((r.game.final_price for r in rows), Decimal("0.00"))
    discount = (subtotal * Decimal(promo.discount_percent if promo else 0) / 100).quantize(CENT)
    total = subtotal - discount
    if total > Decimal("99999999.99"):
        raise ValidationError("Сумма заказа слишком велика.")
    confirmed = {"user": str(user.pk), "recipient": str(recipient.pk), "promo": code,
                 "items": [[str(r.pk), r.game.slug, str(r.game.final_price)] for r in rows],
                 "subtotal": str(subtotal), "discount": str(discount), "total": str(total)}
    return recipient, rows, promo, confirmed


def quote(user, action):
    require_test_mode()
    recipient, rows, promo, data = calculate(user, action)
    return {"recipient": str(recipient.pk), "subtotal": float(data["subtotal"]),
            "discount": float(data["discount"]), "total": float(data["total"]),
            "gift": recipient != user, "promo": promo.code if promo else "",
            "testMode": True, "token": signing.dumps(data, salt=SALT, compress=True)}


def wallet_change(user, amount, message, order=None):
    balance = user.wallet_balance + amount
    if balance < 0 or balance > Decimal("1000000.00"):
        raise ValidationError("Недостаточно средств либо превышен лимит учебного кошелька.")
    user.wallet_balance = balance
    user.save(update_fields=["wallet_balance"])
    WalletEntry.objects.create(user=user, amount=amount, balance_after=balance, text=message, order=order)


def points_change(user, amount, message, order=None):
    p = profile(user)
    if p.points + amount < 0:
        raise ValidationError("Недостаточно баллов.")
    p.points += amount
    p.save(update_fields=["points"])
    PointsEntry.objects.create(user=user, amount=amount, text=message, order=order)


def purchase(user, action):
    require_test_mode()
    recipient, rows, promo, current = calculate(user, action, locked=True)
    try:
        confirmed = signing.loads(action.get("token", ""), salt=SALT, max_age=600)
    except (signing.BadSignature, TypeError):
        raise ValidationError("Подтверждение устарело. Обновите расчёт заказа.") from None
    if confirmed != current:
        raise ValidationError("Корзина или цена изменилась. Подтвердите новый расчёт.")
    method = choice(action.get("method"), ["card", "instant", "wallet"])
    gift_message = text(action.get("giftMessage", ""), 500, required=False)
    total = Decimal(current["total"])
    if method == "wallet" and user.wallet_balance < total:
        raise ValidationError("Недостаточно средств в учебном кошельке.")
    order = Order.objects.create(user=user, recipient=recipient if recipient != user else None,
                                 promo_code=promo, status=Order.STATUS_PAID,
                                 subtotal=current["subtotal"], discount_total=current["discount"], total=total)
    OrderItem.objects.bulk_create([OrderItem(order=order, game=r.game, price_at_purchase=r.game.final_price) for r in rows])
    if promo:
        PromoCode.objects.filter(pk=promo.pk).update(times_used=F("times_used") + 1)
    if method == "wallet":
        wallet_change(user, -total, "Учебная покупка #" + str(order.pk)[:8], order)
    provider_id = "test_" + uuid.uuid4().hex
    payload = {"test_mode": True, "method": method, "real_money": "0.00"}
    payment = Payment.objects.create(order=order, provider="educational", provider_payment_id=provider_id,
                                     status=Payment.STATUS_SUCCEEDED, amount=total, raw_payload=payload)
    PaymentAttempt.objects.create(payment=payment, provider="educational", provider_payment_id=provider_id,
                                  status=Payment.STATUS_SUCCEEDED, amount=total, raw_payload=payload)
    LibraryEntry.objects.bulk_create([LibraryEntry(user=recipient, game=r.game) for r in rows])
    points = int(total // 10)
    points_change(user, points, "Баллы за учебный заказ #" + str(order.pk)[:8], order)
    create("orderMeta", user, order=str(order.pk), method=method, promo=current["promo"], pointsEarned=points)
    if recipient != user:
        create("gifts", user, **{"from": str(user.pk)}, to=str(recipient.pk),
               gameIds=[r.game.slug for r in rows], message=gift_message, opened=False, order=str(order.pk))
        notify(recipient.pk, user, "Вам подарили игру", gift_message or "Игры уже в вашей библиотеке.", "/gifts")
    CartItem.objects.filter(user=user, pk__in=[r.pk for r in rows]).delete()
    Wishlist.objects.filter(user=recipient, game_id__in=[r.game_id for r in rows]).delete()
    return {"id": str(order.pk), "total": float(total), "recipient": recipient.display_name or recipient.username,
            "gift": recipient != user, "pointsEarned": points, "testMode": True, "realMoney": 0}


def commerce_action(user, action):
    kind = action["type"]
    if kind in ("cart", "wishlist"):
        model = CartItem if kind == "cart" else Wishlist
        # Removal must also work after a game is unpublished.
        existing = model.objects.filter(user=user, game__slug=action.get("game")).first()
        if existing:
            existing.delete()
        else:
            game = get_game(action.get("game"))
            if kind == "cart" and LibraryEntry.objects.filter(user=user, game=game).exists():
                raise ValidationError("Игра уже есть в библиотеке.")
            model.objects.create(user=user, game=game)
        return {}
    if kind == "wallet-topup":
        require_test_mode()
        try:
            amount = Decimal(str(action.get("amount")))
        except InvalidOperation:
            raise ValidationError("Введите целую сумму от 1 до 10000.") from None
        if not amount.is_finite() or not 1 <= amount <= 10000 or amount != amount.to_integral_value():
            raise ValidationError("Введите целую сумму от 1 до 10000.")
        user = User.objects.select_for_update().get(pk=user.pk)
        wallet_change(user, amount, "Учебное пополнение — без реальных денег")
        return {"balance": float(user.wallet_balance), "testMode": True}
    if kind == "checkout":
        return purchase(user, action)
    return None


def refund_educational(order):
    """Called under the existing order/user locks; all changes roll back together."""
    if not hasattr(order, "payment") or order.payment.provider != "educational":
        return
    user = User.objects.select_for_update().get(pk=order.user_id)
    earned = sum(PointsEntry.objects.filter(user=user, order=order).values_list("amount", flat=True))
    if profile(user).points < earned:
        raise ValidationError("Баллы за этот заказ уже потрачены. Обратитесь в поддержку.")
    if earned:
        points_change(user, -earned, "Возврат баллов за учебный заказ", order)
    debited = sum(WalletEntry.objects.filter(user=user, order=order).values_list("amount", flat=True), Decimal("0.00"))
    if debited < 0:
        wallet_change(user, -debited, "Возврат учебной покупки", order)
    for gift in Record.objects.filter(kind="gifts", owner=user):
        if gift.data.get("order") == str(order.pk):
            gift.data["refunded"] = True
            gift.save(update_fields=["data", "updated_at"])
