"""Project existing chat messages into the storefront's private snapshot.

The chat Message remains authoritative for both APIs. The Record projection
keeps message reports and existing storefront DTOs compatible.
"""
import uuid

from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver
from apps.chat.models import Message
from .models import Record


def message_record_id(message_id):
    return uuid.uuid5(uuid.NAMESPACE_URL, f"gdstore:chat-message:{message_id}")


@receiver(post_save, sender=Message, dispatch_uid="studio_chat_projection")
def project_message(sender, instance, created, using, raw=False, **kwargs):
    if raw:
        return
    conversation = instance.conversation
    recipient = conversation.second_id if instance.sender_id == conversation.first_id else conversation.first_id
    existing = Record.objects.using(using).filter(pk=message_record_id(instance.pk)).first()
    Record.objects.using(using).update_or_create(pk=message_record_id(instance.pk), defaults={
        "kind": "messages", "owner_id": instance.sender_id,
        "data": {**(existing.data if existing else {}), "from": str(instance.sender_id), "to": str(recipient), "text": instance.text},
    })
    Record.objects.using(using).filter(pk=message_record_id(instance.pk)).update(created_at=instance.created_at)
    if created:
        from .common import notify
        notify(recipient, instance.sender, "Новое сообщение", instance.text[:160], "/messages/" + str(instance.sender_id))


@receiver(post_delete, sender=Message, dispatch_uid="studio_chat_projection_delete")
def remove_projection(sender, instance, using, **kwargs):
    Record.objects.using(using).filter(pk=message_record_id(instance.pk), kind="messages").delete()
