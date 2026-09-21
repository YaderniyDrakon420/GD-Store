"""Signed confirmation of the complete cart displayed by the web client."""
import hashlib
import json
from decimal import Decimal
from django.core import signing
from apps.library.models import LibraryEntry

SALT = "gdstore.cart-confirmation.v1"


def snapshot(user_id, beneficiary_id, items):
    owned = set(LibraryEntry.objects.filter(user_id=beneficiary_id,
        game_id__in=[i.game_id for i in items]).values_list("game_id", flat=True))
    rows = sorted((str(i.pk), str(i.game_id), str(i.game.final_price),
                   i.game.is_published, i.game_id in owned) for i in items)
    digest = hashlib.sha256(json.dumps(rows, separators=(",", ":")).encode()).hexdigest()
    return {"user": str(user_id), "beneficiary": str(beneficiary_id), "cart": digest}, owned


def cart_summary(user_id, items, beneficiary_id=None):
    payload, owned = snapshot(user_id, beneficiary_id or user_id, items)
    reasons = {i.pk: ("Игра уже в библиотеке" if i.game_id in owned else
                      "Игра недоступна" if not i.game.is_published else "") for i in items}
    return {"count": len(items),
        "total": str(sum((i.game.final_price for i in items), Decimal("0.00"))),
        "checkout_token": signing.dumps(payload, salt=SALT, compress=True),
        "can_checkout": bool(items) and not any(reasons.values())}, reasons


def matches_confirmation(token, user_id, beneficiary_id, items):
    try:
        confirmed = signing.loads(token, salt=SALT, max_age=600)
    except signing.BadSignature:
        return False
    current, owned = snapshot(user_id, beneficiary_id, items)
    return confirmed == current and not owned and all(i.game.is_published for i in items)
