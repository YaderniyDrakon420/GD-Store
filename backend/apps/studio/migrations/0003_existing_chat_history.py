import uuid
from django.db import migrations


def copy_history(apps, schema_editor):
    alias = schema_editor.connection.alias
    Message = apps.get_model("chat", "Message")
    Record = apps.get_model("studio", "Record")
    for message in Message.objects.using(alias).select_related("conversation").iterator(chunk_size=500):
        chat = message.conversation
        recipient = chat.second_id if message.sender_id == chat.first_id else chat.first_id
        record_id = uuid.uuid5(uuid.NAMESPACE_URL, f"gdstore:chat-message:{message.pk}")
        Record.objects.using(alias).get_or_create(pk=record_id, defaults={
            "kind": "messages", "owner_id": message.sender_id,
            "data": {"from": str(message.sender_id), "to": str(recipient), "text": message.text},
        })
        Record.objects.using(alias).filter(pk=record_id).update(created_at=message.created_at)


class Migration(migrations.Migration):
    dependencies = [
        ("studio", "0002_mutation_lock"),
        ("chat", "0001_initial"),
        ("accounts", "0002_friendship_blocked_by"),
    ]
    operations = [migrations.RunPython(copy_history, migrations.RunPython.noop)]
