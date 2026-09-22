"""End-to-end regressions for the final catalog, orders and retained history."""
from datetime import date
from decimal import Decimal
import tempfile
import uuid

from django.core.cache import cache
from django.core.management import call_command
from django.db import IntegrityError, transaction
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.accounts.models import User, Friendship
from apps.catalog.models import Game
from apps.library.models import LibraryEntry
from apps.reviews.models import Review
from apps.store.models import CartItem, Order, OrderItem
from .catalog import catalog
from .models import Profile, WalletEntry, PointsEntry

API = "/api/v1/studio/"


@override_settings(PAYMENT_TEST_MODE=True, PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class FinalCatalogTests(TestCase):
    def setUp(self):
        cache.clear()
        self.media = tempfile.TemporaryDirectory()
        self.addCleanup(self.media.cleanup)
        media_settings = override_settings(MEDIA_ROOT=self.media.name)
        media_settings.enable()
        self.addCleanup(media_settings.disable)
        call_command("seed_catalog", verbosity=0)
        self.alice = User.objects.create_user("alice", password="Test-password-42")
        self.bob = User.objects.create_user("bob", password="Test-password-42")
        self.client = APIClient()
        self.client.force_authenticate(self.alice)

    def act(self, data, status=200, key=None):
        response = self.client.post(API + "commands/", data, format="json", HTTP_IDEMPOTENCY_KEY=str(key or uuid.uuid4()))
        self.assertEqual(response.status_code, status, response.data)
        return response.data

    def prepare(self, *slugs, **options):
        for slug in slugs:
            self.act({"type": "cart", "game": slug})
        response = self.client.post(API + "quote/", options, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        return {"type": "checkout", "method": "wallet", "token": response.data["token"], **options}

    def refund(self, order_id):
        response = self.client.post(f"/api/v1/store/orders/{order_id}/refund/")
        self.assertEqual(response.status_code, 200, response.data)

    def test_seed_retires_legacy_games_preserves_history_and_admin_edits(self):
        old = Game.objects.create(slug="orbital", title="Old owned game", price=10, is_published=True)
        LibraryEntry.objects.create(user=self.alice, game=old)
        order = Order.objects.create(user=self.alice, status="paid", total=10)
        OrderItem.objects.create(order=order, game=old, price_at_purchase=10)
        Game.objects.filter(slug="gta-v").update(price=123, title="Admin title")
        call_command("seed_catalog", verbosity=0)
        call_command("seed_catalog", verbosity=0)
        self.assertEqual(set(Game.objects.filter(is_published=True).values_list("slug", flat=True)), {"gta-v", "gta-vi", "cs2", "dota2"})
        self.assertEqual(Game.objects.get(slug="gta-v").price, 123)
        self.assertEqual(Game.objects.get(slug="gta-v").title, "Admin title")
        self.assertEqual(OrderItem.objects.get(order=order).game_id, old.pk)
        retained = next(g for g in catalog(self.alice) if g["id"] == "orbital")
        self.assertFalse(retained["available"])
        self.assertNotIn("orbital", [g["id"] for g in catalog()])

    def test_metadata_is_available_in_both_catalog_apis(self):
        gta = next(g for g in catalog() if g["id"] == "gta-vi")
        self.assertTrue(gta["isPreorder"])
        self.assertEqual(gta["releaseDate"], "2026-11-19")
        self.assertIn("PlayStation 5", gta["platforms"])
        response = self.client.get("/api/v1/catalog/games/gta-vi/")
        self.assertTrue(response.data["is_preorder"])
        self.assertEqual(response.data["official_url"], "https://www.rockstargames.com/VI")
        self.assertTrue(all(g["rating"] is None for g in catalog()))

    def test_malformed_quote_is_a_validation_error(self):
        for body in [[], "invalid", 123]:
            response = self.client.post(API + "quote/", body, format="json")
            self.assertEqual(response.status_code, 400)

    def test_free_games_need_no_balance_and_repeat_request_is_idempotent(self):
        action = self.prepare("cs2", "dota2")
        key = uuid.uuid4()
        first = self.act(action, key=key)["result"]
        second = self.act(action, key=key)["result"]
        self.assertEqual(first, second)
        self.assertEqual(first["total"], 0)
        self.assertEqual(first["realMoney"], 0)
        self.assertEqual(Order.objects.count(), 1)
        self.assertEqual(LibraryEntry.objects.filter(user=self.alice).count(), 2)
        self.assertFalse(WalletEntry.objects.exists())
        self.assertFalse(PointsEntry.objects.exists())

    def test_mixed_order_snapshots_preorder_and_refund_restores_balance(self):
        self.act({"type": "wallet-topup", "amount": 5000})
        result = self.act(self.prepare("gta-v", "gta-vi", "cs2"))["result"]
        self.assertEqual(result["preorders"], ["gta-vi"])
        self.assertEqual(result["total"], 3598)
        self.alice.refresh_from_db()
        self.assertEqual(self.alice.wallet_balance, 1402)
        self.assertTrue(OrderItem.objects.get(game__slug="gta-vi").is_preorder)
        self.assertFalse(OrderItem.objects.get(game__slug="gta-v").is_preorder)
        state = self.client.get(API + "snapshot/").data["state"]
        self.assertEqual(state["orders"][0]["awaitingRelease"], ["gta-vi"])
        self.refund(result["id"])
        self.alice.refresh_from_db()
        self.assertEqual(self.alice.wallet_balance, 5000)
        self.assertFalse(LibraryEntry.objects.exists())
        self.assertEqual(Profile.objects.get(user=self.alice).points, 0)

    def test_quote_rejects_changed_release_state_date_or_platform(self):
        action = self.prepare("gta-vi")
        game = Game.objects.get(slug="gta-vi")
        for field, value in [("is_preorder", False), ("release_date", date(2027, 1, 1)), ("platforms", "Changed platform")]:
            original = getattr(game, field)
            setattr(game, field, value)
            game.save()
            self.act(action, 400)
            setattr(game, field, original)
            game.save()
        self.assertFalse(Order.objects.exists())
        self.assertTrue(CartItem.objects.exists())

    def test_preorder_reviews_blocked_in_both_apis_until_admin_releases_game(self):
        game = Game.objects.get(slug="gta-vi")
        LibraryEntry.objects.create(user=self.alice, game=game)
        self.act({"type": "review", "game": "gta-vi", "positive": True, "text": "Too early"}, 400)
        response = self.client.post("/api/v1/reviews/", {"game": str(game.pk), "is_recommended": True, "text": "Too early"}, format="json")
        self.assertEqual(response.status_code, 400, response.data)
        self.assertFalse(Review.objects.exists())
        game.is_preorder = False
        game.save()
        self.act({"type": "review", "game": "gta-vi", "positive": True, "text": "After release"})
        self.assertEqual(Review.objects.count(), 1)

    def test_actual_user_reviews_determine_rating(self):
        game = Game.objects.get(slug="cs2")
        Review.objects.create(user=self.alice, game=game, is_recommended=True)
        Review.objects.create(user=self.bob, game=game, is_recommended=False)
        row = next(g for g in catalog() if g["id"] == "cs2")
        self.assertEqual(row["rating"], 50)
        self.assertEqual(row["reviewCount"], 2)

    def test_profile_saves_with_new_catalog_and_no_explicit_cover(self):
        self.act({"type": "profile", "name": "Alice", "bio": "Hello", "country": "UA"})
        cover = Profile.objects.get(user=self.alice).appearance["cover"]
        self.assertTrue(Game.objects.filter(slug=cover, is_published=True).exists())

    def test_refunded_retired_gift_remains_resolvable_for_recipient(self):
        Friendship.objects.create(from_user=self.alice, to_user=self.bob, status="accepted")
        result = self.act(self.prepare("gta-vi", recipient=str(self.bob.pk)) | {"method": "instant"})["result"]
        self.assertTrue(LibraryEntry.objects.filter(user=self.bob, game__slug="gta-vi").exists())
        self.refund(result["id"])
        Game.objects.filter(slug="gta-vi").update(is_published=False)
        self.client.force_authenticate(self.bob)
        snapshot = self.client.get(API + "snapshot/").data
        self.assertTrue(snapshot["state"]["gifts"][0]["refunded"])
        self.assertTrue(any(g["id"] == "gta-vi" for g in snapshot["games"]))
        self.assertFalse(LibraryEntry.objects.exists())

    def test_negative_price_is_rejected_by_admin_api_and_database(self):
        self.alice.is_staff = True
        self.alice.save()
        response = self.client.patch("/api/v1/catalog/games/gta-v/", {"price": "-1.00"}, format="json")
        self.assertEqual(response.status_code, 400, response.data)
        with self.assertRaises(IntegrityError), transaction.atomic():
            Game.objects.filter(slug="gta-v").update(price=Decimal("-1"))

    def test_legacy_confirmation_binds_preorder_state(self):
        game = Game.objects.get(slug="gta-vi")
        CartItem.objects.create(user=self.alice, game=game)
        summary = self.client.get("/api/v1/store/cart/summary/")
        game.is_preorder = False
        game.save()
        response = self.client.post("/api/v1/store/cart/checkout/", {"checkout_token": summary.data["checkout_token"]})
        self.assertEqual(response.status_code, 409, response.data)
        summary = self.client.get("/api/v1/store/cart/summary/")
        response = self.client.post("/api/v1/store/cart/checkout/", {"checkout_token": summary.data["checkout_token"]})
        self.assertEqual(response.status_code, 201, response.data)
        self.assertFalse(OrderItem.objects.get().is_preorder)
