"""An allowlisted view of the database for the existing storefront UI.

    Filtering here is a security boundary, not just a presentation filter.
"""
import json
from pathlib import Path

from django.conf import settings
from apps.accounts.models import User, Friendship
from apps.library.models import LibraryEntry
from apps.reviews.models import Review
from apps.store.models import CartItem, Wishlist, Order
from .models import Profile, Record, WalletEntry, PointsEntry
from .common import document
from .catalog import catalog

COSMETICS = json.loads((Path(__file__).with_name("cosmetics.json")).read_text(encoding="utf-8"))
ARRAYS = ("friends messages topics mods orders reviews activity adminLog events notifications "
          "collections gifts reports parties tickets pointsLog walletLog").split()
MAPS = ("library wishlist cart settings subscriptions comparison cosmeticsOwned saleWatch").split()


def snapshot(viewer):
    uid = str(viewer.pk) if viewer.is_authenticated and viewer.is_active else None
    staff = bool(uid and viewer.is_staff)
    state = {key: [] for key in ARRAYS}
    state.update({key: {} for key in MAPS})
    state.update(version=5, active=uid, users=[], announcement={"enabled": False, "text": ""},
                 paymentTestMode=settings.PAYMENT_TEST_MODE)
    profiles = {str(p.user_id): p for p in Profile.objects.all()}
    rels = [{"id": str(f.pk), "from": str(f.from_user_id), "to": str(f.to_user_id),
             "status": f.status, "blockedBy": str(f.blocked_by_id) if f.blocked_by_id else None}
            for f in Friendship.objects.all()]

    def allowed(owner, field):
        if owner == uid:
            return True
        p = profiles.get(owner)
        mode = p.preferences.get(field, "all") if p else "all"
        relation = [f for f in rels if {f["from"], f["to"]} == {owner, uid}]
        return mode == "all" or (mode == "friends" and uid and
                any(f["status"] == "accepted" for f in relation) and
                not any(f["status"] == "blocked" for f in relation))

    for u in User.objects.all():
        owner = str(u.pk)
        p = profiles.get(owner)
        app = p.appearance if p else {}
        pref = p.preferences if p else {}
        public = {k: app[k] for k in ["bio", "country", "color", "status", "avatar", "cover",
                  "cosmeticAvatar", "cosmeticBanner", "cosmeticFrame", "showcase", "banReason"] if k in app}
        if "avatar" not in public and u.avatar:
            public["avatar"] = u.avatar.url
        if "country" not in public and u.country_code:
            public["country"] = u.country_code
        public.update(id=owner, name=u.display_name or u.username, handle=u.username,
                      initials=(u.display_name or u.username)[:2].upper(),
                      role="admin" if u.is_staff else "player", banned=not u.is_active,
                      level=1, status=app.get("status", "offline"))
        if not allowed(owner, "libraryPrivacy"):
            public.pop("showcase", None)
        if owner == uid:
            public.update(email=u.email, wallet=float(u.wallet_balance), points=p.points if p else 0,
                          canManageRoles=u.is_superuser)
            state["settings"][owner] = pref
        else:
            state["settings"][owner] = {k: pref.get(k, "all") for k in
                                        ["libraryPrivacy", "activityPrivacy", "friendsPrivacy", "requestsPrivacy"]}
        state["users"].append(public)
    state["friends"] = [f for f in rels if uid in [f["from"], f["to"]] or
                        (f["status"] == "accepted" and allowed(f["from"], "friendsPrivacy") and
                         allowed(f["to"], "friendsPrivacy"))]
    for row in LibraryEntry.objects.select_related("game"):
        owner = str(row.user_id)
        if allowed(owner, "libraryPrivacy"):
            state["library"].setdefault(owner, []).append(row.game.slug)
    if uid:
        state["cart"][uid] = list(CartItem.objects.filter(user=viewer).values_list("game__slug", flat=True))
        state["wishlist"][uid] = list(Wishlist.objects.filter(user=viewer).values_list("game__slug", flat=True))
        for order in Order.objects.filter(user=viewer).prefetch_related("items__game"):
            state["orders"].append({"id": str(order.pk), "user": uid,
                "games": [i.game.slug for i in order.items.all()], "subtotal": float(order.subtotal),
                "discount": float(order.discount_total), "total": float(order.total),
                "recipient": str(order.recipient_id) if order.recipient_id else uid,
                "status": order.status, "at": order.created_at.isoformat(),
                "method": "Тестовая оплата", "pointsEarned": 0, "promo": ""})
        for model, key in [(WalletEntry, "walletLog"), (PointsEntry, "pointsLog")]:
            state[key] = [{"id": str(x.pk), "user": uid, "amount": float(x.amount),
                           "text": x.text, "at": x.created_at.isoformat()}
                          for x in model.objects.filter(user=viewer).order_by("-created_at")]
    for review in Review.objects.select_related("game"):
        if review.game.is_published:
            state["reviews"].append({"id": str(review.pk), "author": str(review.user_id),
                "game": review.game.slug, "positive": review.is_recommended, "text": review.text,
                "at": review.created_at.isoformat(), "helpful": []})

    subscriptions = []
    for row in Record.objects.all():
        owner, kind, data = str(row.owner_id), row.kind, row.data
        own = uid == owner
        if kind == "announcement":
            state["announcement"] = {"enabled": data.get("enabled", False), "text": data.get("text", "")}
        elif kind == "subscriptions":
            subscriptions.append(row)
        elif kind in ["comparison", "cosmeticsOwned", "saleWatch"]:
            if own:
                state[kind][uid] = data.get("value", {} if kind == "saleWatch" else [])
        elif kind == "orderMeta" and own:
            for order in state["orders"]:
                if order["id"] == data.get("order"):
                    order.update({k: data[k] for k in ("method", "promo", "pointsEarned") if k in data})
        elif kind == "reviewVotes":
            for review in state["reviews"]:
                if review["id"] == data.get("review"):
                    review["helpful"] = data.get("users", [])
        elif kind in ["topics", "mods"]:
            if not data.get("hidden") or own or staff:
                doc = document(row)
                if kind == "mods":
                    doc.pop("upload", None)
                    doc["subscribers"] = 0
                state[kind].append(doc)
        elif kind == "messages":
            if uid and uid in [data.get("from"), data.get("to")]:
                state[kind].append(document(row))
        elif kind == "events":
            if own or (uid and uid in data.get("invitees", [])):
                state[kind].append(document(row))
        elif kind == "parties":
            doc = document(row)
            if not uid or uid not in data.get("members", []):
                doc["messages"] = []
            state[kind].append(doc)
        elif kind == "activity":
            if allowed(owner, "activityPrivacy"):
                state[kind].append(document(row))
        elif kind in ["reports", "tickets"]:
            if own or staff:
                state[kind].append(document(row))
        elif kind == "adminLog":
            if staff:
                state[kind].append(document(row))
        elif kind == "gifts":
            if uid and uid in [owner, data.get("to")]:
                state[kind].append(document(row))
        elif kind in ["notifications", "collections"] and own:
            state[kind].append(document(row))
    for row in subscriptions:
        ids = row.data.get("value", [])
        if str(row.owner_id) == uid:
            state["subscriptions"][uid] = [mid for mid in ids if any(m["id"] == mid and not m.get("hidden") for m in state["mods"])]
        for mod in state["mods"]:
            mod["subscribers"] += mod["id"] in ids
    state["messages"].sort(key=lambda x: (x["at"], x["id"]))
    if staff:
        state["adminStats"] = {"orders": Order.objects.count()}
    return {"state": state, "games": catalog(viewer), "cosmetics": COSMETICS}
