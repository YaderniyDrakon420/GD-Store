from django.conf import settings
from django.db import models


class Conversation(models.Model):
    # Canonical UUID ordering guarantees one conversation per pair.
    first = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="chats_first")
    second = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="chats_second")
    first_read = models.PositiveBigIntegerField(default=0)
    second_read = models.PositiveBigIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["first", "second"], name="chat_unique_pair")]
        ordering = ["-updated_at", "-id"]


class Message(models.Model):
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name="messages")
    sender = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    client_id = models.UUIDField()
    text = models.CharField(max_length=2000)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["conversation", "sender", "client_id"], name="chat_unique_send")]
        indexes = [models.Index(fields=["conversation", "id"], name="chat_message_order")]
        ordering = ["-id"]
