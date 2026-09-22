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
