import uuid
from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    """
    Кастомный юзер. Точки расширения: баланс кошелька, аватар, страна (для региональных цен), 2FA и т.д.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    display_name = models.CharField(max_length=64, blank=True)
    avatar = models.ImageField(upload_to="avatars/", blank=True, null=True)
    country_code = models.CharField(max_length=2, blank=True)
    wallet_balance = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    is_email_verified = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.username


class Friendship(models.Model):
    STATUS_CHOICES = [("pending", "pending"), ("accepted", "accepted"), ("blocked", "blocked")]

    from_user = models.ForeignKey(User, related_name="friend_requests_sent", on_delete=models.CASCADE)
    to_user = models.ForeignKey(User, related_name="friend_requests_received", on_delete=models.CASCADE)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="pending")
    blocked_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="blocks_created")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("from_user", "to_user")
