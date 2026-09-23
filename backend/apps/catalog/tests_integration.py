from decimal import Decimal
from django.contrib.auth import get_user_model
import tempfile
from django.test import TestCase, override_settings
from django.core.management import call_command
from rest_framework.test import APITestCase
from apps.accounts.models import Friendship
from apps.store.models import CartItem
from .models import Game

class CatalogSeedTests(TestCase):
    def test_seed_preserves_existing_game_prices(self):
        game=Game.objects.create(slug="orbital",title="My title",price=Decimal("12.34"),is_published=True)
        with tempfile.TemporaryDirectory() as directory, override_settings(MEDIA_ROOT=directory):
            call_command("seed_catalog",verbosity=0)
        game.refresh_from_db()
        self.assertEqual(game.price,Decimal("12.34"))
        self.assertEqual(game.title,"My title")

class GiftConfirmationTests(APITestCase):
    def test_summary_token_is_bound_to_selected_recipient(self):
        User=get_user_model()
        buyer=User.objects.create_user(username="buyer")
        friend=User.objects.create_user(username="friend")
        Friendship.objects.create(from_user=buyer,to_user=friend,status="accepted")
        game=Game.objects.create(title="Gift",slug="gift",price=Decimal("10"),is_published=True)
        CartItem.objects.create(user=buyer,game=game)
        self.client.force_authenticate(buyer)
        summary=self.client.get("/api/v1/store/cart/summary/?recipient_username=friend")
        self.assertEqual(summary.status_code,200)
        mismatch=self.client.post("/api/v1/store/cart/checkout/",{"checkout_token":summary.data["checkout_token"]})
        self.assertEqual(mismatch.status_code,409)
        result=self.client.post("/api/v1/store/cart/checkout/",{"checkout_token":summary.data["checkout_token"],"recipient_username":"friend"})
        self.assertEqual(result.status_code,201,result.data)
