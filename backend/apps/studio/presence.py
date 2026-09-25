"""Database-backed presence works across workers and separate frontend hosts."""
import hashlib
from datetime import timedelta

from django.contrib.auth.signals import user_logged_out
from django.dispatch import receiver
from django.utils import timezone

from .models import PresenceSession

PRESENCE_TTL_SECONDS = 90
WRITE_INTERVAL_SECONDS = 20


def session_hash(request):
    key = request.session.session_key
    return hashlib.sha256(key.encode()).hexdigest() if key else None


def touch_presence(request):
    if not request.user.is_authenticated or not request.user.is_active or request.auth is not None:
        return
    key = session_hash(request)
    if not key:
        return  # Presence belongs to browser sessions, not unattended API tokens.
    now = timezone.now()
    # UPDATE is the first DB statement in SnapshotView's transaction; SQLite
    # therefore takes its write lock before any read/modify/write sequence.
    updated = PresenceSession.objects.filter(
        pk=key, last_seen__lte=now - timedelta(seconds=WRITE_INTERVAL_SECONDS),
    ).update(user=request.user, last_seen=now)
    if not updated:
        _, created = PresenceSession.objects.get_or_create(
            session_hash=key, defaults={"user": request.user, "last_seen": now},
        )
    else:
        created = False
    if updated or created:
        PresenceSession.objects.filter(last_seen__lt=now - timedelta(days=1)).delete()
        from .models import AccountDevice
        from .security import device_label
        AccountDevice.objects.update_or_create(session_key=request.session.session_key,
            defaults={"user": request.user, "label": device_label(request), "last_seen": now})


def online_users():
    cutoff = timezone.now() - timedelta(seconds=PRESENCE_TTL_SECONDS)
    return set(str(uid) for uid in PresenceSession.objects.filter(
        last_seen__gt=cutoff, user__is_active=True,
    ).values_list("user_id", flat=True))


@receiver(user_logged_out, dispatch_uid="studio_clear_session_presence")
def clear_session_presence(sender, request, user, **kwargs):
    if request is not None and user is not None and user.is_authenticated:
        key = session_hash(request)
        if key:
            PresenceSession.objects.filter(pk=key, user=user).delete()
