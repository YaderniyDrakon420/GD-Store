import tempfile
import uuid
from unittest.mock import patch

from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.accounts.models import User, Friendship
from apps.catalog.models import Game, Screenshot, SystemRequirement
from apps.chat.models import Conversation, Message
from apps.library.models import LibraryEntry
from apps.store.models import Order, OrderItem
from .catalog import catalog
from .chat_bridge import message_record_id
from .models import Record, PinnedMessage, GameReleaseNotice

API = "/api/v1/studio/"


@override_settings(PAYMENT_TEST_MODE=True, PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class ExtraFeaturesTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.alice = User.objects.create_user("alice")
        cls.bob = User.objects.create_user("bob")
        cls.eve = User.objects.create_user("eve")
        cls.admin = User.objects.create_superuser("owner", "owner@example.test", "Test-password-42")
        cls.game = Game.objects.create(slug="first", title="First", price=10, is_published=True)
        cls.next = Game.objects.create(slug="next", title="Next", price=20, is_published=True, is_preorder=True)
        cls.friendship = Friendship.objects.create(from_user=cls.alice, to_user=cls.bob, status="accepted")
        first, second = sorted([cls.alice.pk, cls.bob.pk])
        cls.conversation = Conversation.objects.create(first_id=first, second_id=second)

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.client.force_authenticate(self.alice)

    def act(self, data, status=200, key=None):
        response = self.client.post(API + "commands/", data, format="json", HTTP_IDEMPOTENCY_KEY=str(key or uuid.uuid4()))
        self.assertEqual(response.status_code, status, response.data)
        return response.data

    def snapshot(self):
        return self.client.get(API + "snapshot/").data

    def message(self, body="Meet tonight", sender=None):
        return Message.objects.create(conversation=self.conversation, sender=sender or self.alice, client_id=uuid.uuid4(), text=body)

    def own_preorder(self, user, buyer=None, status="paid", library=True):
        buyer = buyer or user
        order = Order.objects.create(user=buyer, recipient=user if user != buyer else None, total=20, status=status)
        OrderItem.objects.create(order=order, game=self.next, price_at_purchase=20, is_preorder=True)
        if library:
            LibraryEntry.objects.get_or_create(user=user, game=self.next)
        return order

    def release(self):
        self.next.is_preorder = False
        self.next.save()

    def release_notes(self):
        return [r for r in Record.objects.filter(kind="notifications") if r.data.get("category") == "releases"]

    def test_recent_history_orders_revisits_and_is_private_even_from_admin(self):
        for slug in ["first", "next", "first"]:
            self.act({"type": "game-view", "game": slug})
        uid = str(self.alice.pk)
        self.assertEqual(self.snapshot()["state"]["recentViews"], {uid: ["first", "next"]})
        for outsider in [self.bob, self.admin, None]:
            self.client.force_authenticate(outsider)
            self.assertEqual(self.snapshot()["state"]["recentViews"], {})
        self.act({"type": "game-view", "game": "first"}, 401)
        self.client.force_authenticate(self.alice)
        self.act({"type": "recent-clear"})
        self.assertEqual(self.snapshot()["state"]["recentViews"][uid], [])

    def test_recent_history_is_bounded_and_hides_unpublished_games(self):
        for i in range(14):
            slug = f"game-{i}"
            Game.objects.create(slug=slug, title=slug, price=0, is_published=True)
            self.act({"type": "game-view", "game": slug})
        ids = self.snapshot()["state"]["recentViews"][str(self.alice.pk)]
        self.assertEqual(ids, [f"game-{i}" for i in range(13, 1, -1)])
        Game.objects.filter(slug="game-13").update(is_published=False)
        self.assertNotIn("game-13", self.snapshot()["state"]["recentViews"][str(self.alice.pk)])
        self.act({"type": "game-view", "game": "game-13"}, 404)

    def test_gallery_and_requirements_use_catalog_models_and_admin_order(self):
        later = Screenshot.objects.create(game=self.game, image="games/screenshots/later.jpg", order=2)
        first = Screenshot.objects.create(game=self.game, image="games/screenshots/first.jpg", order=0)
        SystemRequirement.objects.create(game=self.game, cpu="Example CPU", notes="SSD required")
        dto = next(g for g in catalog() if g["id"] == "first")
        self.assertEqual([s["id"] for s in dto["screenshots"]], [str(first.pk), str(later.pk)])
        self.assertEqual(dto["requirements"]["notes"], "SSD required")
        self.assertIsNone(next(g for g in catalog() if g["id"] == "next")["requirements"])
        response = self.client.get("/api/v1/catalog/games/first/")
        self.assertEqual(response.data["requirements"]["notes"], "SSD required")

    def test_seed_adds_missing_details_without_overwriting_admin_changes(self):
        with tempfile.TemporaryDirectory() as directory, override_settings(MEDIA_ROOT=directory):
            call_command("seed_catalog", verbosity=0)
            game = Game.objects.get(slug="gta-v")
            self.assertEqual(game.screenshots.count(), 3)
            self.assertEqual(Screenshot.objects.count(), 9)
            requirement = game.requirements
            requirement.ram = "Admin RAM"
            requirement.save()
            shot = game.screenshots.first()
            shot.order = 99
            shot.save()
            call_command("seed_catalog", verbosity=0)
            requirement.refresh_from_db()
            shot.refresh_from_db()
            self.assertEqual(requirement.ram, "Admin RAM")
            self.assertEqual(shot.order, 99)
            self.assertEqual(Screenshot.objects.count(), 9)

    def test_participants_share_pins_and_retries_do_not_toggle(self):
        message = self.message(sender=self.bob)
        action = {"type": "message-pin", "message": str(message_record_id(message.pk)), "pinned": True}
        key = uuid.uuid4()
        self.act(action, key=key)
        self.act(action, key=key)
        self.assertEqual(PinnedMessage.objects.count(), 1)
        self.client.force_authenticate(self.bob)
        row = self.snapshot()["state"]["messages"][0]
        self.assertTrue(row["pinned"])
        self.assertEqual(row["pinnedBy"], str(self.alice.pk))
        self.act({**action, "pinned": False})
        self.assertFalse(PinnedMessage.objects.exists())

    def test_outsiders_admin_and_blocked_friend_cannot_modify_pins(self):
        message = self.message()
        action = {"type": "message-pin", "message": str(message_record_id(message.pk)), "pinned": True}
        for outsider in [self.eve, self.admin]:
            self.client.force_authenticate(outsider)
            self.act(action, 403)
            self.assertEqual(self.snapshot()["state"]["messages"], [])
        self.client.force_authenticate(self.alice)
        self.friendship.status = "blocked"
        self.friendship.blocked_by = self.bob
        self.friendship.save()
        self.act(action, 403)
        self.assertFalse(PinnedMessage.objects.exists())

    def test_pin_limit_and_projection_update_delete(self):
        messages = [self.message(str(i)) for i in range(11)]
        for msg in messages[:10]:
            self.act({"type": "message-pin", "message": str(message_record_id(msg.pk)), "pinned": True})
        self.act({"type": "message-pin", "message": str(message_record_id(messages[0].pk)), "pinned": True})
        self.act({"type": "message-pin", "message": str(message_record_id(messages[-1].pk)), "pinned": True}, 400)
        messages[0].text = "Updated via canonical model"
        messages[0].save()
        self.assertEqual(PinnedMessage.objects.count(), 10)
        messages[0].delete()
        self.assertEqual(PinnedMessage.objects.count(), 9)
        self.act({"type": "message-pin", "message": str(message_record_id(messages[-1].pk)), "pinned": True})

    def test_release_notifies_current_owners_and_gift_recipients_once(self):
        self.own_preorder(self.alice)
        self.own_preorder(self.bob, buyer=self.admin)
        self.own_preorder(self.eve, status="refunded", library=False)
        self.release()
        self.assertEqual({row.owner_id for row in self.release_notes()}, {self.alice.pk, self.bob.pk})
        self.next.title = "Renamed"
        self.next.save()
        self.next.is_preorder = True
        self.next.save()
        self.release()
        self.assertEqual(len(self.release_notes()), 2)
        self.assertEqual(GameReleaseNotice.objects.count(), 2)
        self.client.force_authenticate(self.eve)
        self.assertEqual(self.snapshot()["state"]["notifications"], [])

    def test_release_respects_opt_out_and_does_not_notify_ordinary_purchases(self):
        self.own_preorder(self.alice)
        order = self.own_preorder(self.bob)
        order.items.update(is_preorder=False)
        self.act({"type": "settings", "values": {"notifications": {"releases": False}}})
        self.release()
        self.assertEqual(self.release_notes(), [])
        self.assertEqual(GameReleaseNotice.objects.count(), 1)
        self.act({"type": "settings", "values": {"notifications": {"releases": True}}})
        self.next.save()
        self.assertEqual(self.release_notes(), [])

    def test_staff_api_release_sends_notification_but_unpublished_game_waits(self):
        self.own_preorder(self.alice)
        self.next.is_published = False
        self.next.save()
        self.release()
        self.assertEqual(self.release_notes(), [])
        self.client.force_authenticate(self.admin)
        response = self.client.patch("/api/v1/catalog/games/next/", {"is_published": True}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(self.release_notes()), 1)

    def test_partial_save_does_not_release_an_unsaved_flag(self):
        self.own_preorder(self.alice)
        self.next.is_preorder = False
        self.next.price = 30
        self.next.save(update_fields=["price"])
        self.assertEqual(self.release_notes(), [])
        self.next.refresh_from_db()
        self.assertTrue(self.next.is_preorder)

    def test_failed_notification_rolls_back_release_and_delivery_marker(self):
        self.own_preorder(self.alice)
        with patch("apps.studio.releases.Record.objects") as manager:
            manager.using.return_value.create.side_effect = RuntimeError("Simulated storage failure")
            with self.assertRaises(RuntimeError):
                self.release()
        self.next.refresh_from_db()
        self.assertTrue(self.next.is_preorder)
        self.assertFalse(GameReleaseNotice.objects.exists())
