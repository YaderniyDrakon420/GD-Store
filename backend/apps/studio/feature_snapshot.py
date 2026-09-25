"""Explicit public/private serializers for the extended storefront."""
from datetime import timedelta
from django.utils import timezone
from django.db.models import Q
from apps.catalog.models import Game
from .common import document
from .community_features import BADGES, DEFINITIONS, recommendations
from .models import (AchievementAward, InventoryItem, TradeOffer, MarketListing, StoreProduct,
                     ProductLicense, Record, MediaAttachment, ChatActivity)


def extend_snapshot(state, viewer, allowed):
    uid = state["active"]
    staff = bool(uid and viewer.is_staff)
    state.update(badgeDefinitions=BADGES, hubPosts=[], inventory=[], trades=[], market=[], products=[], licenses=[], recommendationQueue=[], chatActivity=[])
    # One query for all public progression rather than a query for every user.
    by_user = {}
    for row in AchievementAward.objects.all():
        by_user.setdefault(str(row.user_id), []).append(row)
    for user in state["users"]:
        awards = by_user.get(user["id"], [])
        xp = sum(r.xp for r in awards)
        user.update(xp=xp, level=1 + xp // 200, nextLevelXp=(xp // 200 + 1) * 200,
                    badges=[{**DEFINITIONS[r.code], "at": r.created_at.isoformat()} for r in awards if r.code in DEFINITIONS] if allowed(user["id"], "activityPrivacy") else [])
    published = set(Game.objects.filter(is_published=True).values_list("slug", flat=True))
    attachments = {str(a.pk): a for a in MediaAttachment.objects.all()}
    from .attachments import attachment_data
    for row in Record.objects.filter(kind="hubPosts"):
        if row.data.get("game") not in published:
            continue
        if not row.data.get("hidden") or uid == str(row.owner_id) or staff:
            doc = document(row)
            media = attachments.get(doc.get("attachment"))
            doc["media"] = attachment_data(media) if media else None
            state["hubPosts"].append(doc)
    for message in state["messages"]:
        media = attachments.get(message.get("attachment"))
        message["media"] = attachment_data(media) if media else None
    if uid:
        state["recommendationQueue"] = recommendations(viewer)
        friends = {f["to"] if f["from"] == uid else f["from"] for f in state["friends"] if uid in [f["from"], f["to"]] and f["status"] == "accepted"}
        friends.difference_update(f["to"] if f["from"] == uid else f["from"] for f in state["friends"] if uid in [f["from"], f["to"]] and f["status"] == "blocked")
        trades = list(TradeOffer.objects.filter(Q(sender=viewer) | Q(recipient=viewer)).order_by("-created_at"))
        all_pending = list(TradeOffer.objects.filter(status="pending", created_at__gt=timezone.now() - timedelta(days=7)))
        reserved = {i for t in all_pending for i in t.offered}
        reserved.update(str(i) for i in MarketListing.objects.filter(status="active").values_list("item_id", flat=True))
        visible_items = {str(i.pk): i for i in InventoryItem.objects.all()}

        def item_data(i):
            return {"id": str(i.pk), "owner": str(i.owner_id), "code": i.code,
                    "title": "Карточка «" + DEFINITIONS.get(i.code, {}).get("title", i.code) + "»",
                    "color": DEFINITIONS.get(i.code, {}).get("color", "teal"), "reserved": str(i.pk) in reserved}

        state["inventory"] = [item_data(i) for i in visible_items.values() if str(i.owner_id) in friends | {uid}]
        state["trades"] = [{"id": str(t.pk), "from": str(t.sender_id), "to": str(t.recipient_id),
            "offered": [item_data(visible_items[i]) for i in t.offered if i in visible_items],
            "requested": [item_data(visible_items[i]) for i in t.requested if i in visible_items],
            "status": "expired" if t.status == "pending" and t.created_at <= timezone.now() - timedelta(days=7) else t.status,
            "at": t.created_at.isoformat()} for t in trades]
        state["market"] = [{"id": str(r.pk), "item": item_data(r.item), "seller": str(r.seller_id), "price": float(r.price), "status": r.status}
                           for r in MarketListing.objects.select_related("item").filter(Q(status="active", seller__is_active=True) | Q(seller=viewer) | Q(buyer=viewer)).order_by("-created_at")]
        state["chatActivity"] = [{"user": str(r.user_id), "peer": str(r.peer_id), "readAt": r.read_at.isoformat() if r.read_at else None,
                                  "typing": bool(r.typing_until and r.typing_until > timezone.now())}
                                 for r in ChatActivity.objects.filter(Q(user=viewer) | Q(peer=viewer)) if str(r.user_id) in friends | {uid} and str(r.peer_id) in friends | {uid}]
        state["licenses"] = [{"product": r.product_id, "title": r.product.title, "kind": r.product.kind,
                              "game": r.product.game.slug if r.product.game else None, "content": r.product.bonus_content, "order": str(r.order_id)}
                             for r in ProductLicense.objects.filter(user=viewer).select_related("product__game")]
    for p in StoreProduct.objects.select_related("game").prefetch_related("games"):
        if not staff and (not p.is_published or (p.game and not p.game.is_published) or any(not g.is_published for g in p.games.all())):
            continue
        dto = {"id": p.slug, "title": p.title, "kind": p.kind, "game": p.game.slug if p.game else None,
               "games": [g.slug for g in p.games.all()], "description": p.description, "price": float(p.price),
               "discount": p.discount_percent, "finalPrice": float(p.final_price), "published": p.is_published}
        if staff:
            dto["bonus"] = p.bonus_content
        state["products"].append(dto)
