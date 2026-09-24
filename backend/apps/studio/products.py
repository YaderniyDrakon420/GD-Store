"""Products reuse normal orders, wallet entries and refunds."""
import uuid
from decimal import Decimal

from django.core import signing
from django.utils.crypto import salted_hmac
from rest_framework.exceptions import ValidationError

from apps.accounts.models import User
from apps.library.models import LibraryEntry
from apps.payments.models import Payment, PaymentAttempt
from apps.store.models import Order, OrderItem, Wishlist
from apps.store.services import pending_order_contains_games
from .common import create, require_staff, text, choice, get_game, string_list
from .commerce import require_test_mode, wallet_change, points_change
from .models import StoreProduct, ProductLicense

SALT = "gdstore.product.v1"


def product_data(user, slug, locked=False):
    rows = StoreProduct.objects.select_for_update() if locked else StoreProduct.objects
    p = rows.filter(slug=text(slug, 50), is_published=True).select_related("game").first()
    if not p:
        raise ValidationError("Товар недоступен.")
    if p.kind not in ["edition", "dlc", "bundle"] or (p.kind != "bundle" and not p.game):
        raise ValidationError("Товар ещё не настроен администратором.")
    owned = set(LibraryEntry.objects.filter(user=user).values_list("game_id", flat=True))
    if ProductLicense.objects.filter(user=user, product=p).exists():
        raise ValidationError("Лицензия уже есть в библиотеке.")
    games = list(p.games.all()) if p.kind == "bundle" else ([] if p.kind == "dlc" else [p.game])
    if p.kind == "bundle" and not games:
        raise ValidationError("В комплекте нет игр.")
    if any(not g.is_published for g in games) or (p.game and not p.game.is_published):
        raise ValidationError("Игра в составе товара недоступна.")
    if p.kind == "dlc" and (p.game_id not in owned or p.game.is_preorder):
        raise ValidationError("Для дополнения нужна выпущенная основная игра в библиотеке.")
    missing = [g for g in games if g.pk not in owned]
    if p.kind == "bundle" and not missing:
        raise ValidationError("Все игры комплекта уже есть в библиотеке.")
    if pending_order_contains_games(user.pk, [g.pk for g in missing]):
        raise ValidationError("На игру из комплекта уже есть ожидающий оплаты заказ.")
    # Already-owned free games must not discount a paid game in the bundle.
    total = p.final_price
    if p.kind == "bundle":
        regular = sum((g.final_price for g in games), Decimal("0.00"))
        missing_value = sum((g.final_price for g in missing), Decimal("0.00"))
        ratio = missing_value / regular if regular else Decimal(len(missing)) / len(games)
        total = (total * ratio).quantize(Decimal("0.01"))
    value = {"user": str(user.pk), "product": p.slug, "title": p.title, "kind": p.kind,
             "total": str(total), "price": str(p.final_price), "game": p.game.slug if p.game else None,
             "games": sorted(g.slug for g in games), "newGames": sorted(g.slug for g in missing),
             "gamePrices": sorted([g.slug, str(g.final_price)] for g in games),
             "preorders": sorted(g.slug for g in missing if g.is_preorder), "description": p.description,
             "bonus": salted_hmac(SALT, p.bonus_content).hexdigest()}
    return p, missing, value


def product_quote(user, action):
    require_test_mode()
    p, games, data = product_data(user, action.get("product"))
    return {"title": p.title, "total": float(data["total"]), "games": data["newGames"], "preorders": data["preorders"],
            "testMode": True, "token": signing.dumps(data, salt=SALT, compress=True)}


def products_action(user, a):
    if a["type"] == "product-save":
        require_staff(user)
        import re
        from decimal import InvalidOperation
        slug = text(a.get("slug"), 50)
        if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", slug):
            raise ValidationError("Код товара: латинские буквы, цифры и дефисы.")
        kind = choice(a.get("kind"), ["edition", "dlc", "bundle"])
        game = get_game(a["game"]) if a.get("game") else None
        if kind != "bundle" and not game:
            raise ValidationError("Выберите основную игру.")
        games = [get_game(slug) for slug in string_list(a.get("games", []), 30)]
        if kind == "bundle" and len(games) < 2:
            raise ValidationError("В комплекте должны быть минимум две игры.")
        try:
            price = Decimal(str(a.get("price")))
            discount = a.get("discount", 0)
            if not price.is_finite() or not 0 <= price <= 999999 or price != price.quantize(Decimal("0.01")) or type(discount) is not int or not 0 <= discount <= 100:
                raise InvalidOperation
        except (InvalidOperation, TypeError, ValueError):
            raise ValidationError("Проверьте цену и скидку от 0 до 100%.") from None
        if type(a.get("published", True)) is not bool:
            raise ValidationError("Передайте состояние публикации.")
        existing = StoreProduct.objects.filter(pk=slug).first()
        if existing and ProductLicense.objects.filter(product=existing).exists():
            if existing.kind != kind or existing.game_id != (game.pk if game else None) or set(existing.games.values_list("pk", flat=True)) != {g.pk for g in games}:
                raise ValidationError("Состав проданного товара менять нельзя. Создайте новый товар.")
        p, _ = StoreProduct.objects.update_or_create(slug=slug, defaults={"kind": kind, "game": game, "price": price,
            "discount_percent": discount, "is_published": a.get("published", True), "title": text(a.get("title"), 160),
            "description": text(a.get("description", ""), 5000, required=False), "bonus_content": text(a.get("bonus", ""), 12000, required=False)})
        p.games.set(games)
        return {"id": slug}
    if a["type"] != "product-buy":
        return None
    require_test_mode()
    user = User.objects.select_for_update().get(pk=user.pk)
    p, games, current = product_data(user, a.get("product"), locked=True)
    try:
        confirmed = signing.loads(a.get("token", ""), salt=SALT, max_age=600)
    except (signing.BadSignature, TypeError):
        raise ValidationError("Обновите расчёт покупки.") from None
    if confirmed != current:
        raise ValidationError("Цена, состав или библиотека изменились. Подтвердите новый расчёт.")
    total = Decimal(current["total"])
    order = Order.objects.create(user=user, status="paid", subtotal=total, total=total)
    wallet_change(user, -total, "Учебная покупка: " + p.title, order)
    for i, g in enumerate(games):
        share = (total / len(games)).quantize(Decimal("0.01"))
        amount = total - share * (len(games) - 1) if i == len(games) - 1 else share
        OrderItem.objects.create(order=order, game=g, price_at_purchase=amount, is_preorder=g.is_preorder)
        LibraryEntry.objects.create(user=user, game=g)
    ProductLicense.objects.create(user=user, product=p, order=order)
    pid = "test_" + uuid.uuid4().hex
    payload = {"test_mode": True, "method": "wallet", "real_money": "0.00", "product": p.slug}
    payment = Payment.objects.create(order=order, provider="educational", provider_payment_id=pid, status="succeeded", amount=total, raw_payload=payload)
    PaymentAttempt.objects.create(payment=payment, provider="educational", provider_payment_id=pid, status="succeeded", amount=total, raw_payload=payload)
    points = int(total // 10)
    if points:
        points_change(user, points, "Баллы за учебный товар " + p.title, order)
    create("orderMeta", user, order=str(order.pk), method="wallet", pointsEarned=points, productTitle=p.title, product=p.slug)
    Wishlist.objects.filter(user=user, game__in=games).delete()
    return {"id": str(order.pk), "testMode": True}


def refund_products(order):
    games = list(order.items.values_list("game_id", flat=True))
    if ProductLicense.objects.filter(user=order.beneficiary, product__kind="dlc", product__game_id__in=games).exclude(order=order).exists():
        raise ValidationError("Сначала верните дополнения к игре, затем основную игру.")
    ProductLicense.objects.filter(order=order).delete()
