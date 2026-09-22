import uuid
from datetime import timedelta

from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.catalog.models import Game


class CartItem(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="cart_items", on_delete=models.CASCADE)
    game = models.ForeignKey(Game, on_delete=models.CASCADE)
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("user", "game")
        ordering = ["-added_at"]

    def __str__(self):
        return f"{self.user} — {self.game}"


class Wishlist(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="wishlist_items", on_delete=models.CASCADE)
    game = models.ForeignKey(Game, on_delete=models.CASCADE)
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("user", "game")
        ordering = ["-added_at"]

    def __str__(self):
        return f"{self.user} — {self.game}"


class PromoCode(models.Model):
    """times_used = оплаченные применения + резервы pending-заказов.

    Cancel/expiry освобождают резерв. Оплата сохраняет использование;
    refund не возвращает лимит, чтобы не создавать цикл повторной скидки.
    """
    code = models.CharField(max_length=32, unique=True)
    discount_percent = models.PositiveSmallIntegerField()
    max_uses = models.PositiveIntegerField(null=True, blank=True, help_text="Пусто = без ограничения")
    times_used = models.PositiveIntegerField(default=0)
    valid_from = models.DateTimeField(null=True, blank=True)
    valid_until = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return f"{self.code} (-{self.discount_percent}%)"

    def is_valid(self):
        now = timezone.now()

        if not self.is_active:
            return False

        if self.discount_percent > 100:
            return False

        if self.valid_from and now < self.valid_from:
            return False

        if self.valid_until and now > self.valid_until:
            return False

        if (
            self.max_uses is not None
            and self.times_used >= self.max_uses
        ):
            return False

        return True


class Order(models.Model):
    STATUS_PENDING = "pending"
    STATUS_PAID = "paid"
    STATUS_FAILED = "failed"
    STATUS_REFUNDED = "refunded"
    STATUS_CANCELLED = "cancelled"
    STATUS_EXPIRED = "expired"
    STATUS_CHOICES = [
        (STATUS_PENDING, "pending"),
        (STATUS_PAID, "paid"),
        (STATUS_FAILED, "failed"),
        (STATUS_REFUNDED, "refunded"),
        (STATUS_CANCELLED, "cancelled"),
        (STATUS_EXPIRED, "expired"),
    ]
    # Заказ можно отменить/оплатить, пока он в одном из этих статусов.
    OPEN_STATUSES = [STATUS_PENDING]

    DEFAULT_TTL_MINUTES = 30

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="orders", on_delete=models.CASCADE)
    # Если оформляется подарок другу — recipient указан, и библиотека пополняется у него, а не у покупателя.
    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="gifted_orders",
        null=True, blank=True, on_delete=models.PROTECT,
    )
    promo_code = models.ForeignKey(PromoCode, null=True, blank=True, on_delete=models.SET_NULL)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=STATUS_PENDING)
    subtotal = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    discount_total = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    total = models.DecimalField(max_digits=10, decimal_places=2)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Order {self.id} ({self.status})"

    def save(self, *args, **kwargs):
        if self.expires_at is None and self.status == self.STATUS_PENDING:
            self.expires_at = timezone.now() + timedelta(minutes=self.DEFAULT_TTL_MINUTES)
        super().save(*args, **kwargs)

    @property
    def beneficiary(self):
        """Кому достанутся игры — получателю подарка или самому покупателю."""
        return self.recipient or self.user

    @property
    def is_gift(self):
        return self.recipient_id is not None and self.recipient_id != self.user_id


class OrderItem(models.Model):
    order = models.ForeignKey(Order, related_name="items", on_delete=models.CASCADE)
    game = models.ForeignKey(Game, on_delete=models.PROTECT)
    price_at_purchase = models.DecimalField(max_digits=8, decimal_places=2)
    is_preorder = models.BooleanField(default=False)

    class Meta:
        unique_together = ("order", "game")

    def __str__(self):
        return f"{self.game} in {self.order_id}"
