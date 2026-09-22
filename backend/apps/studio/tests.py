from datetime import timedelta
from decimal import Decimal
from io import BytesIO
from pathlib import Path
import tempfile
import uuid
import zipfile

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User, Friendship
from apps.catalog.models import Game
from apps.library.models import LibraryEntry
from apps.store.models import Order, CartItem, PromoCode
from apps.payments.models import Payment
from .models import Profile, Record, WalletEntry, PointsEntry, Upload
from .common import profile

API = "/api/v1/studio/"


@override_settings(PAYMENT_TEST_MODE=True, PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class StudioTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.alice = User.objects.create_user("alice", "alice@example.com", "A-str0ng-password!")
        cls.bob = User.objects.create_user("bob", "bob@example.com", "A-str0ng-password!")
        cls.eve = User.objects.create_user("eve", "eve@example.com", "A-str0ng-password!")
        cls.admin = User.objects.create_superuser("owner", "owner@example.com", "A-str0ng-password!")
        cls.game = Game.objects.create(slug="orbital", title="ORBITAL", price=Decimal("19.99"), discount_percent=10, is_published=True)
        cls.second = Game.objects.create(slug="ashen", title="ASHEN", price=Decimal("10.00"), is_published=True)

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.as_user(self.alice)

    def as_user(self, user):
        self.actor = user
        self.client.force_authenticate(user=user)

    def act(self, action, status=200, key=None):
        response = self.client.post(API + "commands/", action, format="json",
            HTTP_IDEMPOTENCY_KEY=str(key or uuid.uuid4()), HTTP_X_STORE_USER=str(self.actor.pk))
        self.assertEqual(response.status_code, status, response.data)
        return response.data

    def snapshot(self):
        result = self.client.get(API + "snapshot/")
        self.assertEqual(result.status_code, 200, result.data)
        return result.data["state"]

    def befriend(self):
        Friendship.objects.create(from_user=self.alice, to_user=self.bob, status="accepted")

    def prepare(self, **extra):
        self.act({"type": "cart", "game": "orbital"})
        response = self.client.post(API + "quote/", extra, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        return {"type": "checkout", "method": "instant", "token": response.data["token"], **extra}

    def test_money_requires_explicit_test_mode(self):
        with override_settings(PAYMENT_TEST_MODE=False):
            self.act({"type": "wallet-topup", "amount": 100}, 403)
            self.act({"type": "checkout", "method": "instant"}, 403)
            self.assertEqual(self.client.post(API + "quote/", {}, format="json").status_code, 403)
        self.assertFalse(WalletEntry.objects.exists())

    def test_idempotent_topup_and_payload_binding(self):
        key = uuid.uuid4()
        action = {"type": "wallet-topup", "amount": 100}
        self.act(action, key=key)
        self.act(action, key=key)
        self.alice.refresh_from_db()
        self.assertEqual(self.alice.wallet_balance, 100)
        self.assertEqual(WalletEntry.objects.count(), 1)
        self.act({**action, "amount": 200}, 400, key)

    def test_invalid_topups(self):
        for value in [-1, 0, 10001, 1.5, "NaN", "Infinity", "bad", True, None]:
            with self.subTest(value=value):
                self.act({"type": "wallet-topup", "amount": value}, 400)

    def test_checkout_uses_decimal_and_fulfills_only_once(self):
        self.act({"type": "wallet-topup", "amount": 100})
        action = {**self.prepare(), "method": "wallet"}
        key = uuid.uuid4()
        first = self.act(action, key=key)
        second = self.act(action, key=key)
        self.assertEqual(first["result"]["id"], second["result"]["id"])
        self.assertEqual(first["result"]["total"], 17.99)
        self.alice.refresh_from_db()
        self.assertEqual(self.alice.wallet_balance, Decimal("82.01"))
        self.assertEqual(Order.objects.count(), 1)
        self.assertEqual(Payment.objects.get().provider, "educational")
        self.assertEqual(LibraryEntry.objects.get().user, self.alice)
        self.assertEqual(profile(self.alice).points, 1)
        self.assertFalse(CartItem.objects.exists())
        self.act(action, 400)

    def test_insufficient_wallet_rolls_back_everything(self):
        action = {**self.prepare(), "method": "wallet"}
        self.act(action, 400)
        self.assertFalse(Order.objects.exists())
        self.assertTrue(CartItem.objects.exists())
        self.assertFalse(LibraryEntry.objects.exists())

    def test_stale_quote_and_promo_are_revalidated(self):
        PromoCode.objects.create(code="PLAY10", discount_percent=10)
        action = self.prepare(promo="PLAY10")
        self.game.price = 25
        self.game.save()
        self.act(action, 400)
        self.assertFalse(Order.objects.exists())
        self.assertEqual(PromoCode.objects.get().times_used, 0)

    def test_gift_only_to_friend_and_not_already_owned(self):
        self.befriend()
        action = self.prepare(recipient=str(self.bob.pk), giftMessage="Enjoy")
        self.act(action)
        self.assertEqual(LibraryEntry.objects.get().user, self.bob)
        self.as_user(self.bob)
        state = self.snapshot()
        self.assertEqual(len(state["gifts"]), 1)
        self.assertEqual(state["orders"], [])
        self.act({"type": "gift-open", "gift": state["gifts"][0]["id"]})
        self.as_user(self.eve)
        self.assertEqual(self.snapshot()["gifts"], [])
        self.act({"type": "gift-open", "gift": state["gifts"][0]["id"]}, 403)
        self.as_user(self.alice)
        self.act({"type": "cart", "game": "orbital"})
        self.assertEqual(self.client.post(API + "quote/", {"recipient": str(self.bob.pk)}, format="json").status_code, 400)
        self.assertEqual(self.client.post(API + "quote/", {"recipient": str(self.eve.pk)}, format="json").status_code, 400)

    def test_refund_restores_wallet_and_points_exactly_once(self):
        self.act({"type": "wallet-topup", "amount": 100})
        result = self.act({**self.prepare(), "method": "wallet"})["result"]
        url = "/api/v1/store/orders/" + result["id"] + "/refund/"
        response = self.client.post(url)
        self.assertEqual(response.status_code, 200, response.data)
        self.alice.refresh_from_db()
        self.assertEqual(self.alice.wallet_balance, 100)
        self.assertEqual(profile(self.alice).points, 0)
        self.assertFalse(LibraryEntry.objects.exists())
        self.assertEqual(self.client.post(url).status_code, 400)

    def test_profile_cannot_change_role_balance_or_recovery(self):
        self.act({"type": "profile", "name": "New name", "bio": "bio", "country": "UA",
                  "color": "#123456", "cover": "orbital", "avatar": "", "role": "admin", "wallet": 9999})
        self.alice.refresh_from_db()
        self.assertEqual(self.alice.display_name, "New name")
        self.assertFalse(self.alice.is_staff)
        self.assertEqual(self.alice.wallet_balance, 0)
        self.act({"type": "settings", "values": {"role": "admin"}}, 400)

    def test_friends_and_private_messages(self):
        self.act({"type": "message", "user": str(self.bob.pk), "text": "secret"}, 403)
        self.act({"type": "request", "user": str(self.bob.pk)})
        fid = str(Friendship.objects.get().pk)
        self.act({"type": "accept", "friend": fid}, 403)
        self.as_user(self.bob)
        self.act({"type": "accept", "friend": fid})
        self.act({"type": "message", "user": str(self.alice.pk), "text": "secret"})
        self.as_user(self.alice)
        message = self.snapshot()["messages"][0]
        self.act({"type": "report-create", "kind": "message", "user": str(self.bob.pk),
                  "messageId": message["id"], "reason": "Спам"})
        self.as_user(self.eve)
        self.assertEqual(self.snapshot()["messages"], [])
        self.act({"type": "report-create", "kind": "message", "user": str(self.bob.pk),
                  "messageId": message["id"], "reason": "Спам"}, 403)
        self.as_user(self.alice)
        self.act({"type": "block", "user": str(self.bob.pk)})
        self.as_user(self.bob)
        self.act({"type": "message", "user": str(self.alice.pk), "text": "blocked"}, 403)
        self.act({"type": "unfriend", "friend": str(Friendship.objects.get().pk)}, 403)

    def test_snapshot_does_not_leak_private_accounts(self):
        p = profile(self.alice)
        p.preferences = {"libraryPrivacy": "none", "activityPrivacy": "none", "friendsPrivacy": "none"}
        p.recovery_hash = "NEVER-RETURN-THIS"
        p.save()
        LibraryEntry.objects.create(user=self.alice, game=self.game)
        self.act({"type": "wallet-topup", "amount": 100})
        self.act({"type": "ticket-create", "title": "private", "category": "Аккаунт", "text": "secret ticket"})
        self.as_user(self.eve)
        state = self.snapshot()
        other = next(u for u in state["users"] if u["id"] == str(self.alice.pk))
        for key in ["wallet", "points", "email", "auth", "recovery_hash"]:
            self.assertNotIn(key, other)
        self.assertNotIn(str(self.alice.pk), state["library"])
        self.assertEqual(state["tickets"], [])
        self.assertEqual(state["walletLog"], [])
        self.assertNotIn("NEVER-RETURN-THIS", str(state))

    def test_topic_ownership_moderation_and_reply(self):
        result = self.act({"type": "topic", "title": "Topic", "body": "Body", "game": "orbital"})["result"]
        tid = result["id"]
        self.as_user(self.bob)
        self.act({"type": "edit-topic", "topic": tid, "title": "stolen", "body": "body"}, 403)
        self.act({"type": "reply", "topic": tid, "text": "Reply"})
        self.act({"type": "admin-moderate", "collection": "topics", "item": tid, "field": "hidden"}, 403)
        self.as_user(self.admin)
        self.act({"type": "admin-moderate", "collection": "topics", "item": tid, "field": "hidden"})
        self.as_user(self.bob)
        self.assertEqual(self.snapshot()["topics"], [])
        self.act({"type": "reply", "topic": tid, "text": "hidden reply"}, 403)

    def test_support_is_private_and_admin_answers(self):
        tid = self.act({"type": "ticket-create", "title": "Help", "category": "Покупка", "text": "Question"})["result"]["id"]
        self.as_user(self.bob)
        self.act({"type": "ticket-reply", "ticket": tid, "text": "intruder"}, 403)
        self.as_user(self.admin)
        self.act({"type": "ticket-reply", "ticket": tid, "text": "Answer"})
        self.act({"type": "ticket-status", "ticket": tid, "status": "resolved"})
        self.as_user(self.alice)
        self.assertEqual(self.snapshot()["tickets"][0]["messages"][-1]["text"], "Answer")
        self.act({"type": "ticket-reply", "ticket": tid, "text": "closed"}, 400)

    def test_role_assignment_and_ban(self):
        self.as_user(self.admin)
        self.act({"type": "admin-role", "user": str(self.bob.pk), "role": "admin"})
        self.bob.refresh_from_db()
        self.as_user(self.bob)
        self.act({"type": "admin-role", "user": str(self.eve.pk), "role": "admin"}, 403)
        self.act({"type": "admin-ban", "user": str(self.admin.pk), "reason": "no"}, 403)
        self.act({"type": "admin-ban", "user": str(self.alice.pk), "reason": "spam"})
        self.as_user(self.alice)
        self.act({"type": "topic", "title": "banned", "body": "banned"}, 400)

    def test_events_restrict_invitations_and_rsvp(self):
        self.befriend()
        at = (timezone.now() + timedelta(days=1)).isoformat()
        eid = self.act({"type": "event-create", "title": "Evening", "game": "orbital", "startsAt": at,
                        "invitees": [str(self.bob.pk)]})["result"]["id"]
        self.as_user(self.eve)
        self.assertEqual(self.snapshot()["events"], [])
        self.act({"type": "event-rsvp", "event": eid, "status": "going"}, 403)
        self.as_user(self.bob)
        self.act({"type": "event-rsvp", "event": eid, "status": "going"})
        self.act({"type": "event-cancel", "event": eid}, 403)
        self.as_user(self.alice)
        self.act({"type": "event-cancel", "event": eid})

    def test_team_capacity_membership_and_message_privacy(self):
        pid = self.act({"type": "party-save", "title": "Party", "game": "orbital", "capacity": 2,
                        "language": "Українська", "startsAt": (timezone.now() + timedelta(days=1)).isoformat()})["result"]["id"]
        self.as_user(self.bob)
        self.act({"type": "party-message", "party": pid, "text": "outside"}, 403)
        self.act({"type": "party-join", "party": pid})
        self.act({"type": "party-message", "party": pid, "text": "inside"})
        self.as_user(self.eve)
        self.act({"type": "party-join", "party": pid}, 400)
        self.assertEqual(self.snapshot()["parties"][0]["messages"], [])
        self.as_user(self.bob)
        self.act({"type": "party-leave", "party": pid})
        self.assertEqual(self.snapshot()["parties"][0]["messages"], [])

    def test_collections_and_showcase_require_owned_games(self):
        self.act({"type": "collection-save", "name": "Mine", "color": "teal", "gameIds": ["orbital"]}, 400)
        LibraryEntry.objects.create(user=self.alice, game=self.game)
        cid = self.act({"type": "collection-save", "name": "Mine", "color": "teal", "gameIds": ["orbital"]})["result"]["id"]
        self.act({"type": "showcase-save", "title": "My games", "games": ["orbital"]})
        self.as_user(self.bob)
        self.assertEqual(self.snapshot()["collections"], [])
        self.act({"type": "collection-delete", "collection": cid}, 403)

    def test_reviews_votes_and_cosmetics(self):
        self.act({"type": "review", "game": "orbital", "text": "Nice", "positive": True}, 403)
        LibraryEntry.objects.create(user=self.alice, game=self.game)
        rid = self.act({"type": "review", "game": "orbital", "text": "Nice", "positive": True})["result"]["id"]
        self.act({"type": "review-vote", "review": rid}, 403)
        self.as_user(self.bob)
        self.act({"type": "review-vote", "review": rid})
        self.assertIn(str(self.bob.pk), self.snapshot()["reviews"][0]["helpful"])
        self.act({"type": "review-vote", "review": rid})
        self.assertEqual(self.snapshot()["reviews"][0]["helpful"], [])
        self.act({"type": "cosmetic-buy", "item": "frame-teal"}, 400)
        p = profile(self.bob)
        p.points = 200
        p.save()
        self.act({"type": "cosmetic-buy", "item": "frame-teal"})
        self.act({"type": "cosmetic-equip", "slot": "frame", "item": "frame-teal"})
        self.assertEqual(profile(self.bob).points, 80)
        self.assertEqual(PointsEntry.objects.get(user=self.bob).amount, -120)

    def test_real_zip_upload_download_and_hidden_access(self):
        buffer = BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("README.txt", "Workshop test")
        with tempfile.TemporaryDirectory() as directory, override_settings(PRIVATE_UPLOAD_ROOT=Path(directory)):
            response = self.client.post(API + "uploads/", {"file": SimpleUploadedFile("mod.zip", buffer.getvalue(), content_type="application/zip")}, format="multipart")
            self.assertEqual(response.status_code, 201, response.data)
            mid = self.act({"type": "mod", "title": "Mod", "description": "Description", "game": "orbital",
                           "category": "Карты", "version": "1.0", "upload": response.data["id"]})["result"]["id"]
            self.as_user(self.bob)
            download = self.client.get(API + "mods/" + mid + "/download/")
            self.assertEqual(download.status_code, 200)
            self.assertEqual(b"".join(download.streaming_content), buffer.getvalue())
            download.close()
            self.act({"type": "subscribe", "mod": mid})
            self.act({"type": "edit-mod", "mod": mid, "title": "stolen"}, 403)
            self.as_user(self.admin)
            self.act({"type": "admin-moderate", "collection": "mods", "item": mid, "field": "hidden"})
            self.as_user(self.bob)
            self.assertEqual(self.client.get(API + "mods/" + mid + "/download/").status_code, 403)
            self.assertEqual(self.snapshot()["mods"], [])

    def test_invalid_upload_and_cross_account_action(self):
        response = self.client.post(API + "uploads/", {"file": SimpleUploadedFile("bad.zip", b"not zip")}, format="multipart")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Upload.objects.count(), 0)
        response = self.client.post(API + "commands/", {"type": "wallet-topup", "amount": 100}, format="json",
            HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()), HTTP_X_STORE_USER=str(self.bob.pk))
        self.assertEqual(response.status_code, 403)

    def test_unpublished_games_remain_removable_and_in_owners_library(self):
        CartItem.objects.create(user=self.alice, game=self.game)
        LibraryEntry.objects.create(user=self.alice, game=self.second)
        Game.objects.all().update(is_published=False)
        games = self.client.get(API + "snapshot/").data["games"]
        self.assertEqual({g["id"] for g in games}, {"orbital", "ashen"})
        self.assertTrue(all(g["available"] is False for g in games))
        self.act({"type": "cart", "game": "orbital"})
        self.assertFalse(CartItem.objects.exists())
        self.as_user(self.eve)
        self.assertEqual(self.client.get(API + "snapshot/").data["games"], [])

    def test_partial_preferences_and_legacy_friendship_privacy(self):
        self.act({"type": "privacy-save", "values": {"libraryPrivacy": "none"}})
        self.act({"type": "privacy-save", "values": {"requestsPrivacy": "none"}})
        self.assertEqual(profile(self.alice).preferences["libraryPrivacy"], "none")
        self.as_user(self.bob)
        response = self.client.post("/api/v1/auth/friendships/", {"to_user": str(self.alice.pk)}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertFalse(Friendship.objects.exists())


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class SessionTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient(enforce_csrf_checks=True)

    def csrf(self):
        return self.client.get(API + "snapshot/").data["csrf"]

    def test_register_login_recovery_and_csrf(self):
        body = {"mode": "register", "handle": "real_player", "name": "Player", "email": "player@example.com", "password": "A-str0ng-password!"}
        self.assertEqual(self.client.post(API + "account/", body, format="json").status_code, 403)
        response = self.client.post(API + "account/", body, format="json", HTTP_X_CSRFTOKEN=self.csrf())
        self.assertEqual(response.status_code, 200, response.data)
        code = response.data["recovery"]
        self.assertTrue(self.client.cookies["sessionid"]["httponly"])
        self.assertTrue(self.client.get(API + "snapshot/").data["state"]["active"])
        command = {"type": "preferences-reset"}
        self.assertEqual(self.client.post(API + "commands/", command, format="json", HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4())).status_code, 403)
        self.client.post(API + "account/", {"mode": "logout"}, format="json", HTTP_X_CSRFTOKEN=self.csrf())
        self.assertIsNone(self.client.get(API + "snapshot/").data["state"]["active"])
        response = self.client.post(API + "account/", {"mode": "reset", "login": "real_player", "recovery": code,
            "password": "A-new-strong-password!"}, format="json", HTTP_X_CSRFTOKEN=self.csrf())
        self.assertEqual(response.status_code, 200, response.data)
        response = self.client.post(API + "account/", {"mode": "login", "login": "player@example.com", "password": "A-new-strong-password!"}, format="json", HTTP_X_CSRFTOKEN=self.csrf())
        self.assertEqual(response.status_code, 200, response.data)

    def test_cannot_login_with_wrong_password_or_weak_registration(self):
        response = self.client.post(API + "account/", {"mode": "register", "handle": "weak", "name": "Player",
            "email": "weak@example.com", "password": "12345678"}, format="json", HTTP_X_CSRFTOKEN=self.csrf())
        self.assertEqual(response.status_code, 400)
        response = self.client.post(API + "account/", {"mode": "login", "login": "nobody", "password": "bad"},
                                    format="json", HTTP_X_CSRFTOKEN=self.csrf())
        self.assertEqual(response.status_code, 400)
