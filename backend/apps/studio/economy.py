"""Atomic transfers of GD Store collectible cards, never external Steam assets."""
from datetime import timedelta
from decimal import Decimal, InvalidOperation

from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.accounts.models import User
from .common import friends, get_user, identifier, notify, string_list
from .commerce import require_test_mode, wallet_change
from .models import InventoryItem, MarketListing, TradeOffer


def pending_trades():
    return TradeOffer.objects.filter(status="pending", created_at__gt=timezone.now() - timedelta(days=7))


def reserved(item_id, except_trade=None):
    if MarketListing.objects.filter(item_id=item_id, status="active").exists():
        return True
    return any(str(item_id) in t.offered for t in pending_trades().exclude(pk=except_trade))


def items_owned(ids, owner, except_trade=None):
    ids = string_list(ids, 10)
    items = list(InventoryItem.objects.filter(pk__in=[identifier(i) for i in ids], owner=owner))
    if len(items) != len(ids):
        raise ValidationError("Владелец предмета изменился. Обновите предложение.")
    if any(reserved(i.pk, except_trade) for i in items):
        raise ValidationError("Предмет уже выставлен на продажу или предложен в другом обмене.")
    return items


def invalidate_other_trades(ids, keep=None):
    values = {str(i) for i in ids}
    for trade in pending_trades().exclude(pk=keep):
        if values.intersection(trade.offered + trade.requested):
            trade.status = "unavailable"
            trade.save(update_fields=["status", "updated_at"])


def economy_action(user, a):
    kind = a["type"]
    if kind == "trade-create":
        other = get_user(a.get("user"))
        if user == other or not friends(user, other):
            raise PermissionDenied("Обмен доступен между друзьями.")
        if pending_trades().filter(sender=user).count() >= 10:
            raise ValidationError("Можно открыть не более 10 предложений одновременно.")
        offered = items_owned(a.get("offered", []), user)
        requested = items_owned(a.get("requested", []), other)
        if not offered and not requested:
            raise ValidationError("Выберите хотя бы один предмет.")
        row = TradeOffer.objects.create(sender=user, recipient=other, offered=[str(i.pk) for i in offered], requested=[str(i.pk) for i in requested])
        notify(other.pk, user, "Предложение обмена", "Проверьте предметы перед подтверждением", "/inventory")
        return {"id": str(row.pk)}
    if kind in ("trade-accept", "trade-decline", "trade-cancel"):
        trade = pending_trades().filter(pk=identifier(a.get("trade"))).first()
        if not trade:
            raise ValidationError("Предложение закрыто или истекло.")
        actor = trade.sender_id if kind == "trade-cancel" else trade.recipient_id
        if actor != user.pk:
            raise PermissionDenied("Это действие доступно другому участнику обмена.")
        if kind == "trade-accept":
            if not trade.sender.is_active or not friends(trade.sender, trade.recipient):
                raise PermissionDenied("Обмен между этими игроками недоступен.")
            offered = items_owned(trade.offered, trade.sender, trade.pk)
            requested = items_owned(trade.requested, trade.recipient, trade.pk)
            InventoryItem.objects.filter(pk__in=[i.pk for i in offered]).update(owner=trade.recipient)
            InventoryItem.objects.filter(pk__in=[i.pk for i in requested]).update(owner=trade.sender)
            invalidate_other_trades([i.pk for i in offered + requested], trade.pk)
            trade.status = "accepted"
            notify(trade.sender_id, user, "Обмен завершён", "Предметы переданы обоим участникам", "/inventory")
        else:
            trade.status = "cancelled" if kind == "trade-cancel" else "declined"
        trade.save(update_fields=["status", "updated_at"])
        if kind == "trade-accept":
            from .community_features import sync_achievements
            sync_achievements(trade.sender)
        return {}
    if kind == "market-list":
        require_test_mode()
        items = items_owned([a.get("item")], user)
        try:
            price = Decimal(str(a.get("price")))
            if not price.is_finite() or price != price.quantize(Decimal("0.01")) or not Decimal("0.01") <= price <= 10000:
                raise InvalidOperation
        except (InvalidOperation, ValueError):
            raise ValidationError("Цена: от 0,01 до 10000 с двумя знаками после запятой.") from None
        row = MarketListing.objects.create(item=items[0], seller=user, price=price)
        invalidate_other_trades([items[0].pk])
        return {"id": str(row.pk)}
    if kind in ("market-buy", "market-cancel"):
        listing = MarketListing.objects.select_related("item", "seller").filter(pk=identifier(a.get("listing")), status="active").first()
        if not listing:
            raise ValidationError("Предмет уже куплен или снят с продажи.")
        if kind == "market-cancel":
            if listing.seller_id != user.pk:
                raise PermissionDenied("Снять предмет может только продавец.")
            listing.status = "cancelled"
        else:
            require_test_mode()
            if listing.seller_id == user.pk or not listing.seller.is_active or listing.item.owner_id != listing.seller_id:
                raise ValidationError("Покупка этого предмета недоступна.")
            people = {p.pk: p for p in User.objects.select_for_update().filter(pk__in=[user.pk, listing.seller_id]).order_by("pk")}
            buyer, seller = people[user.pk], people[listing.seller_id]
            wallet_change(buyer, -listing.price, "Покупка карточки на учебной площадке")
            wallet_change(seller, listing.price, "Продажа карточки на учебной площадке")
            listing.item.owner = buyer
            listing.item.save(update_fields=["owner"])
            listing.buyer, listing.status = buyer, "sold"
            invalidate_other_trades([listing.item_id])
            notify(seller.pk, buyer, "Карточка продана", "Учебный баланс пополнен", "/inventory")
        listing.save(update_fields=["status", "buyer"])
        return {}
    return None
