"""Persistent community data. Commerce continues to use the existing store models."""
import uuid

from django.conf import settings
from django.db import models


class Profile(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    appearance = models.JSONField(default=dict, blank=True)
    preferences = models.JSONField(default=dict, blank=True)
    points = models.PositiveIntegerField(default=0)
    recovery_hash = models.CharField(max_length=256, blank=True)


class PresenceSession(models.Model):
    """One browser login; only a hash of the session key is retained."""
    session_hash = models.CharField(max_length=64, primary_key=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    last_seen = models.DateTimeField(db_index=True)


class Record(models.Model):
    """Versioned, server-validated documents for the small community sections.

    The kind and owner columns are indexed; clients cannot write documents directly.
    Sensitive documents are filtered by permissions BEFORE serialization.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    kind = models.CharField(max_length=32, db_index=True)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    data = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "id"]
        indexes = [models.Index(fields=["kind", "owner"])]


class Operation(models.Model):
    """An idempotency receipt; retrying a request cannot charge/toggle twice."""
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    key = models.UUIDField()
    fingerprint = models.CharField(max_length=64)
    result = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "key"], name="studio_operation_key")]


class MutationLock(models.Model):
    """A shared write lock for this educational app, including SQLite.

    UPDATE is deliberately the first statement of every community transaction.
    A row lock serializes writers on SQL Server; SQLite takes its database write
    lock. This avoids read/modify/write races in nested replies and memberships.
    """
    id = models.PositiveSmallIntegerField(primary_key=True, default=1)
    revision = models.BigIntegerField(default=0)


class WalletEntry(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    balance_after = models.DecimalField(max_digits=10, decimal_places=2)
    text = models.CharField(max_length=240)
    order = models.ForeignKey("store.Order", on_delete=models.PROTECT, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class PointsEntry(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    amount = models.IntegerField()
    text = models.CharField(max_length=240)
    order = models.ForeignKey("store.Order", on_delete=models.PROTECT, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class Upload(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    # Private storage: never exposed through MEDIA_URL.
    storage_name = models.CharField(max_length=100, unique=True)
    original_name = models.CharField(max_length=180)
    size = models.PositiveIntegerField()
    sha256 = models.CharField(max_length=64)
    created_at = models.DateTimeField(auto_now_add=True)


class GamePresentation(models.Model):
    game = models.OneToOneField("catalog.Game", on_delete=models.CASCADE)
    data = models.JSONField(default=dict, blank=True)


class PinnedMessage(models.Model):
    message = models.OneToOneField(Record, on_delete=models.CASCADE, related_name="chat_pin")
    pinned_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)


class GameReleaseNotice(models.Model):
    """Persistent delivery marker, also records an explicit notification opt-out."""
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    game = models.ForeignKey("catalog.Game", on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "game"], name="studio_release_once")]


class AchievementAward(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    code = models.CharField(max_length=40)
    xp = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "code"], name="studio_award_once")]


class InventoryItem(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    code = models.CharField(max_length=40)
    # Origin is immutable: selling a reward never makes it claimable again.
    award = models.OneToOneField(AchievementAward, on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)


class TradeOffer(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sender = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="sent_trades", on_delete=models.PROTECT)
    recipient = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="received_trades", on_delete=models.PROTECT)
    offered = models.JSONField(default=list)
    requested = models.JSONField(default=list)
    status = models.CharField(max_length=16, default="pending")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class MarketListing(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    item = models.ForeignKey(InventoryItem, on_delete=models.PROTECT)
    seller = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="market_sales", on_delete=models.PROTECT)
    buyer = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="market_purchases", on_delete=models.PROTECT, null=True)
    price = models.DecimalField(max_digits=8, decimal_places=2)
    status = models.CharField(max_length=16, default="active")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.CheckConstraint(condition=models.Q(price__gt=0), name="studio_listing_positive")]


class StoreProduct(models.Model):
    """Optional editions, DLC licenses and bundles, authored by an administrator."""
    slug = models.SlugField(primary_key=True)
    title = models.CharField(max_length=160)
    kind = models.CharField(max_length=16, choices=[("edition", "Издание"), ("dlc", "Дополнение"), ("bundle", "Комплект")])
    game = models.ForeignKey("catalog.Game", on_delete=models.PROTECT, null=True, blank=True)
    games = models.ManyToManyField("catalog.Game", related_name="store_products", blank=True)
    description = models.TextField(blank=True)
    bonus_content = models.TextField(blank=True, help_text="Текстовое цифровое дополнение, доступно только владельцу лицензии.")
    price = models.DecimalField(max_digits=8, decimal_places=2)
    discount_percent = models.PositiveSmallIntegerField(default=0)
    is_published = models.BooleanField(default=False)

    @property
    def final_price(self):
        from decimal import Decimal
        return (self.price * (100 - self.discount_percent) / 100).quantize(Decimal("0.01"))

    class Meta:
        constraints = [models.CheckConstraint(condition=models.Q(price__gte=0, discount_percent__lte=100), name="studio_product_price")]

    def __str__(self):
        return self.title


class ProductLicense(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    product = models.ForeignKey(StoreProduct, on_delete=models.PROTECT)
    order = models.ForeignKey("store.Order", on_delete=models.PROTECT)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "product"], name="studio_product_owned")]


class MediaAttachment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    storage_name = models.CharField(max_length=100, unique=True)
    original_name = models.CharField(max_length=180)
    mime = models.CharField(max_length=50)
    size = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)


class ChatActivity(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="chat_activity", on_delete=models.CASCADE)
    peer = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="peer_activity", on_delete=models.CASCADE)
    read_at = models.DateTimeField(null=True)
    typing_until = models.DateTimeField(null=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "peer"], name="studio_chat_activity")]


class AccountSecurity(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    # Encrypted with a key derived from DJANGO_SECRET_KEY, never in a snapshot.
    secret = models.TextField(blank=True)
    enabled = models.BooleanField(default=False)
    last_counter = models.BigIntegerField(default=-1)
    backup_hashes = models.JSONField(default=list)


class AccountToken(models.Model):
    digest = models.CharField(primary_key=True, max_length=64)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    purpose = models.CharField(max_length=20)
    email = models.EmailField()
    expires_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)


class AccountDevice(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    session_key = models.CharField(max_length=40, unique=True)
    label = models.CharField(max_length=200)
    created_at = models.DateTimeField(auto_now_add=True)
    last_seen = models.DateTimeField()


class AuthenticationWindow(models.Model):
    """Shared across workers; never stores the submitted password or OTP."""
    identity = models.CharField(max_length=64, primary_key=True)
    count = models.PositiveIntegerField(default=0)
    started_at = models.DateTimeField()
