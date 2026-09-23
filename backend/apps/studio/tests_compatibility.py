import importlib
import uuid
from types import SimpleNamespace

from django.apps import apps
from django.db import connection
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from apps.accounts.models import User, Friendship
from apps.chat.models import Conversation, Message
from .models import Record
from .chat_bridge import message_record_id


class ExistingIntegrationTests(TestCase):
    def setUp(self):
        cache.clear()
        self.alice = User.objects.create_user(username="alice")
        self.bob = User.objects.create_user(username="bob")
        self.friend = Friendship.objects.create(from_user=self.alice, to_user=self.bob, status="accepted")
        self.client = APIClient()
        self.client.force_authenticate(self.alice)

    def act(self, action):
        return self.client.post("/api/v1/studio/commands/", action, format="json",
            HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()))

    def test_both_chat_apis_share_history_and_receipts(self):
        result = self.client.post("/api/v1/chat/conversations/", {"peer": str(self.bob.pk)})
        url = f'/api/v1/chat/conversations/{result.data["id"]}/messages/'
        key = str(uuid.uuid4())
        payload = {"client_id": key, "text": "old API"}
        self.assertEqual(self.client.post(url, payload).status_code, 201)
        self.assertEqual(self.client.post(url, payload).status_code, 200)
        self.assertEqual(Record.objects.filter(kind="messages").count(), 1)
        result = self.act({"type": "message", "user": str(self.bob.pk), "text": "new API"})
        self.assertEqual(result.status_code, 200, result.data)
        self.client.force_authenticate(self.bob)
        self.assertEqual({m["text"] for m in self.client.get(url).data["results"]}, {"old API", "new API"})
        state = self.client.get("/api/v1/studio/snapshot/").data["state"]
        self.assertEqual({m["text"] for m in state["messages"]}, {"old API", "new API"})
        self.assertEqual(len(state["notifications"]), 2)

    def test_block_owner_is_preserved_when_recipient_created_block(self):
        self.client.force_authenticate(self.bob)
        response = self.client.post(f"/api/v1/auth/friends/{self.friend.pk}/block/")
        self.assertEqual(response.status_code, 200)
        self.client.force_authenticate(self.alice)
        state = self.client.get("/api/v1/studio/snapshot/").data["state"]
        self.assertEqual(state["friends"][0]["blockedBy"], str(self.bob.pk))
        self.assertEqual(self.act({"type": "unfriend", "friend": str(self.friend.pk)}).status_code, 403)
        self.assertEqual(self.act({"type": "block", "user": str(self.bob.pk)}).status_code, 200)
        self.assertEqual(Friendship.objects.filter(status="blocked").count(), 2)
        self.client.force_authenticate(self.bob)
        self.assertEqual(self.act({"type": "unfriend", "friend": str(self.friend.pk)}).status_code, 200)
        self.assertEqual(Friendship.objects.get().blocked_by_id, self.alice.pk)
        self.assertEqual(self.act({"type": "message", "user": str(self.alice.pk), "text": "blocked"}).status_code, 403)

    def test_existing_chat_migration_is_idempotent_and_preserves_dates(self):
        first, second = sorted([self.alice.pk, self.bob.pk])
        chat = Conversation.objects.create(first_id=first, second_id=second)
        # bulk_create simulates rows that predate installation of the projection.
        Message.objects.bulk_create([Message(conversation=chat, sender=self.alice,
            client_id=uuid.uuid4(), text="existing history")])
        message = Message.objects.get()
        migration = importlib.import_module("apps.studio.migrations.0003_existing_chat_history")
        for _ in range(2):
            migration.copy_history(apps, SimpleNamespace(connection=connection))
        row = Record.objects.get(kind="messages")
        self.assertEqual(row.pk, message_record_id(message.pk))
        self.assertEqual(row.created_at, message.created_at)
        self.assertEqual(row.data["to"], str(self.bob.pk))
        self.assertEqual(row.data["text"], "existing history")
        self.assertFalse(Record.objects.filter(kind="notifications").exists())

    def test_existing_avatar_and_country_remain_visible(self):
        self.alice.avatar = "avatars/retained.png"
        self.alice.country_code = "UA"
        self.alice.save()
        state = self.client.get("/api/v1/studio/snapshot/").data["state"]
        user = next(row for row in state["users"] if row["id"] == str(self.alice.pk))
        self.assertEqual(user["avatar"], "/media/avatars/retained.png")
        self.assertEqual(user["country"], "UA")
        from apps.catalog.models import Game
        Game.objects.create(title="Orbital", slug="orbital", price=10, is_published=True)
        result = self.act({"type": "profile", "name": "Alice updated", "avatar": user["avatar"], "cover": "orbital"})
        self.assertEqual(result.status_code, 200, result.data)
