import base64
from datetime import timedelta
from decimal import Decimal
from io import BytesIO
import tempfile
import time
import uuid
from urllib.parse import parse_qs, urlparse

from PIL import Image
from django.core import mail
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User, Friendship
from apps.catalog.models import Game, Genre
from apps.library.models import LibraryEntry
from apps.store.models import Order
from .community_features import sync_achievements
from .models import (AchievementAward, AccountDevice, AccountSecurity, AccountToken, AuthenticationWindow,
                     ChatActivity, InventoryItem, ProductLicense, StoreProduct, TradeOffer, WalletEntry)
from .security import cipher, totp

API = "/api/v1/studio/"
PASSWORD = "Long-password-example-42"


class FeatureTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.a = User.objects.create_user("alice", "alice@example.test", PASSWORD, wallet_balance=100)
        cls.b = User.objects.create_user("bob", "bob@example.test", PASSWORD, wallet_balance=100)
        cls.e = User.objects.create_user("eve", "eve@example.test", PASSWORD)
        cls.staff = User.objects.create_superuser("admin", "admin@example.test", PASSWORD)
        Friendship.objects.create(from_user=cls.a, to_user=cls.b, status="accepted")
        cls.g = Game.objects.create(slug="first", title="First", price=20, is_published=True)
        cls.g2 = Game.objects.create(slug="second", title="Second", price=30, is_published=True)

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.client.force_authenticate(self.a)

    def act(self, action, status=200, key=None):
        result = self.client.post(API + "commands/", action, format="json", HTTP_IDEMPOTENCY_KEY=str(key or uuid.uuid4()))
        self.assertEqual(result.status_code, status, result.data)
        return result.data

    def card(self, user, code="collector"):
        award = AchievementAward.objects.create(user=user, code=code, xp=100)
        return InventoryItem.objects.create(owner=user, code=code, award=award)

    def snapshot(self):
        return self.client.get(API + "snapshot/").data["state"]

    def test_awards_once_after_real_activity_and_after_card_transfer(self):
        LibraryEntry.objects.create(user=self.a, game=self.g)
        for _ in range(2):
            sync_achievements(self.a)
        self.assertEqual(AchievementAward.objects.filter(user=self.a).count(), 2)
        item = InventoryItem.objects.get(owner=self.a, code="collector")
        item.owner = self.b
        item.save()
        sync_achievements(self.a)
        self.assertFalse(InventoryItem.objects.filter(owner=self.a, code="collector").exists())
        self.act({"type": "badge-equip", "badge": "creator"}, 403)
        self.act({"type": "badge-equip", "badge": "collector"})
        own = next(u for u in self.snapshot()["users"] if u["id"] == str(self.a.pk))
        self.assertEqual(own["xp"], 150)
        self.assertEqual(own["featuredBadge"], "collector")

    def test_trade_recipient_confirmation_reservations_and_idempotency(self):
        first, second = self.card(self.a), self.card(self.b)
        trade = self.act({"type": "trade-create", "user": str(self.b.pk), "offered": [str(first.pk)], "requested": [str(second.pk)]})["result"]["id"]
        self.act({"type": "market-list", "item": str(first.pk), "price": "10"}, 400)
        self.act({"type": "trade-accept", "trade": trade}, 403)
        self.client.force_authenticate(self.e)
        self.assertEqual(self.snapshot()["trades"], [])
        self.assertEqual(self.snapshot()["inventory"], [])
        self.act({"type": "trade-accept", "trade": trade}, 403)
        self.client.force_authenticate(self.b)
        key = uuid.uuid4()
        for _ in range(2):
            self.act({"type": "trade-accept", "trade": trade}, key=key)
        first.refresh_from_db(); second.refresh_from_db()
        self.assertEqual(first.owner, self.b)
        self.assertEqual(second.owner, self.a)
        self.assertEqual(AchievementAward.objects.filter(code="trader").count(), 2)

    def test_trade_cannot_spend_requested_item_after_it_is_listed(self):
        first, second = self.card(self.a), self.card(self.b)
        trade = self.act({"type": "trade-create", "user": str(self.b.pk), "offered": [str(first.pk)], "requested": [str(second.pk)]})["result"]["id"]
        self.client.force_authenticate(self.b)
        self.act({"type": "market-list", "item": str(second.pk), "price": "10"})
        self.act({"type": "trade-accept", "trade": trade}, 400)
        first.refresh_from_db()
        self.assertEqual(first.owner, self.a)

    def test_blocked_expired_cancelled_trades_do_not_transfer_items(self):
        item = self.card(self.a)
        trade = self.act({"type": "trade-create", "user": str(self.b.pk), "offered": [str(item.pk)]})["result"]["id"]
        self.client.force_authenticate(self.b)
        self.act({"type": "block", "user": str(self.a.pk)})
        self.act({"type": "trade-accept", "trade": trade}, 403)
        TradeOffer.objects.filter(pk=trade).update(created_at=timezone.now() - timedelta(days=8))
        self.assertEqual(self.snapshot()["trades"][0]["status"], "expired")
        self.act({"type": "trade-accept", "trade": trade}, 400)

    def test_market_transfers_wallets_once_and_records_both_sides(self):
        item = self.card(self.a)
        listing = self.act({"type": "market-list", "item": str(item.pk), "price": "12.25"})["result"]["id"]
        self.act({"type": "market-buy", "listing": listing}, 400)
        self.client.force_authenticate(self.b)
        self.act({"type": "market-cancel", "listing": listing}, 403)
        key = uuid.uuid4()
        for _ in range(2):
            self.act({"type": "market-buy", "listing": listing}, key=key)
        self.a.refresh_from_db(); self.b.refresh_from_db(); item.refresh_from_db()
        self.assertEqual(self.a.wallet_balance, Decimal("112.25"))
        self.assertEqual(self.b.wallet_balance, Decimal("87.75"))
        self.assertEqual(item.owner, self.b)
        self.assertEqual(WalletEntry.objects.count(), 2)
        self.act({"type": "market-buy", "listing": listing}, 400)

    def test_market_money_is_atomic_when_seller_balance_would_overflow(self):
        item = self.card(self.a)
        listing = self.act({"type": "market-list", "item": str(item.pk), "price": "10"})["result"]["id"]
        User.objects.filter(pk=self.a.pk).update(wallet_balance=1000000)
        self.client.force_authenticate(self.b)
        self.act({"type": "market-buy", "listing": listing}, 400)
        self.b.refresh_from_db(); item.refresh_from_db()
        self.assertEqual(self.b.wallet_balance, 100)
        self.assertEqual(item.owner, self.a)
        self.assertEqual(WalletEntry.objects.count(), 0)

    def test_market_and_product_payments_require_server_test_mode(self):
        item = self.card(self.a)
        with override_settings(PAYMENT_TEST_MODE=False):
            self.act({"type": "market-list", "item": str(item.pk), "price": "10"}, 403)
            self.act({"type": "product-buy", "product": "whatever", "token": ""}, 403)

    def test_recommendations_use_genres_and_private_feedback(self):
        genre = Genre.objects.create(name="Action", slug="action")
        self.g.genres.add(genre); self.g2.genres.add(genre)
        LibraryEntry.objects.create(user=self.a, game=self.g)
        self.assertEqual(self.snapshot()["recommendationQueue"][0]["game"], "second")
        self.assertIn("Action", self.snapshot()["recommendationQueue"][0]["reason"])
        self.act({"type": "recommendation", "game": "second", "value": "skip"})
        self.assertEqual(self.snapshot()["recommendationQueue"], [])
        self.client.force_authenticate(self.b)
        self.assertTrue(self.snapshot()["recommendationQueue"])
        self.client.force_authenticate(self.a)
        self.act({"type": "recommendations-reset"})
        self.act({"type": "recommendation", "game": "second", "value": "like"})
        self.assertIn("second", self.snapshot()["wishlist"][str(self.a.pk)])

    def test_hub_news_requires_staff_and_content_is_moderated(self):
        content = {"type": "hub-save", "category": "news", "title": "Update", "body": "Changes", "game": "first"}
        self.act(content, 403)
        content["category"] = "guide"
        post = self.act(content)["result"]["id"]
        self.assertTrue(AchievementAward.objects.filter(user=self.a, code="guide").exists())
        self.client.force_authenticate(self.b)
        self.act({**content, "post": post}, 403)
        self.act({"type": "hub-delete", "post": post}, 403)
        self.act({"type": "hub-comment", "post": post, "text": "Thanks"})
        self.act({"type": "hub-like", "post": post})
        self.assertEqual(len(self.snapshot()["hubPosts"][0]["comments"]), 1)
        self.client.force_authenticate(self.staff)
        self.act({"type": "hub-moderate", "post": post, "hidden": True})
        self.client.force_authenticate(self.b)
        self.assertEqual(self.snapshot()["hubPosts"], [])
        self.act({"type": "hub-comment", "post": post, "text": "Hidden"}, 403)
        self.client.force_authenticate(self.a)
        self.act({"type": "hub-delete", "post": post})

    def product(self, kind="bundle"):
        p = StoreProduct.objects.create(slug=kind, title=kind, kind=kind, game=self.g if kind != "bundle" else None,
                                        price=40, discount_percent=25, is_published=True, bonus_content="Private extra content")
        if kind == "bundle":
            p.games.set([self.g, self.g2])
        return p

    def buy_product(self, product):
        quote = self.client.post(API + "quote/", {"product": product.pk}, format="json")
        self.assertEqual(quote.status_code, 200, quote.data)
        return self.act({"type": "product-buy", "product": product.pk, "token": quote.data["token"]})

    def test_bundle_excludes_owned_games_from_price_and_survives_refund(self):
        LibraryEntry.objects.create(user=self.a, game=self.g)
        p = self.product()
        purchased = self.buy_product(p)
        order = Order.objects.get(pk=purchased["result"]["id"])
        self.assertEqual(order.total, 18)
        self.assertEqual(list(order.items.values_list("game_id", flat=True)), [self.g2.pk])
        self.assertEqual(self.snapshot()["licenses"][0]["content"], "Private extra content")
        self.assertNotIn("bonus", self.snapshot()["products"][0])
        response = self.client.post(f"/api/v1/store/orders/{order.pk}/refund/", {}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(LibraryEntry.objects.filter(user=self.a, game=self.g).exists())
        self.assertFalse(LibraryEntry.objects.filter(user=self.a, game=self.g2).exists())
        self.assertFalse(ProductLicense.objects.filter(order=order).exists())
        self.a.refresh_from_db()
        self.assertEqual(self.a.wallet_balance, 100)

    def test_product_quote_rejects_changed_price_and_double_ownership(self):
        p = self.product("edition")
        quote = self.client.post(API + "quote/", {"product": p.pk}, format="json").data
        p.price = 50; p.save()
        self.act({"type": "product-buy", "product": p.pk, "token": quote["token"]}, 400)
        self.assertEqual(Order.objects.count(), 0)
        self.buy_product(p)
        self.assertEqual(self.client.post(API + "quote/", {"product": p.pk}, format="json").status_code, 400)

    def test_dlc_requires_base_and_refunds_in_dependency_order(self):
        dlc = self.product("dlc")
        self.assertEqual(self.client.post(API + "quote/", {"product": dlc.pk}, format="json").status_code, 400)
        base = self.buy_product(self.product("edition"))["result"]["id"]
        extra = self.buy_product(dlc)["result"]["id"]
        self.assertEqual(self.client.post(f"/api/v1/store/orders/{base}/refund/", {}, format="json").status_code, 400)
        self.assertEqual(self.client.post(f"/api/v1/store/orders/{extra}/refund/", {}, format="json").status_code, 200)
        self.assertEqual(self.client.post(f"/api/v1/store/orders/{base}/refund/", {}, format="json").status_code, 200)

    def test_product_management_requires_admin_and_locks_sold_composition(self):
        a = {"type": "product-save", "slug": "deluxe", "title": "Deluxe", "kind": "edition", "game": "first", "price": "20", "discount": 0}
        self.act(a, 403)
        self.client.force_authenticate(self.staff)
        self.act(a)
        self.client.force_authenticate(self.a)
        self.buy_product(StoreProduct.objects.get(pk="deluxe"))
        self.client.force_authenticate(self.staff)
        self.act({**a, "game": "second"}, 400)

    def test_typing_read_receipts_private_and_expire(self):
        response = self.client.post(API + "chat-activity/", {"user": str(self.b.pk), "typing": True, "read": True}, format="json")
        self.assertEqual(response.status_code, 200)
        self.client.force_authenticate(self.b)
        self.assertTrue(self.snapshot()["chatActivity"][0]["typing"])
        ChatActivity.objects.update(typing_until=timezone.now() - timedelta(seconds=1))
        self.assertFalse(self.snapshot()["chatActivity"][0]["typing"])
        self.client.force_authenticate(self.e)
        self.assertEqual(self.snapshot()["chatActivity"], [])
        self.assertEqual(self.client.post(API + "chat-activity/", {"user": str(self.a.pk), "typing": True}, format="json").status_code, 403)

    def test_private_attachment_access_and_public_screenshot_moderation(self):
        with tempfile.TemporaryDirectory() as folder, override_settings(PRIVATE_UPLOAD_ROOT=folder):
            output = BytesIO(); Image.new("RGB", (4, 4), "red").save(output, format="PNG")
            response = self.client.post(API + "attachments/", {"file": SimpleUploadedFile("image.png", output.getvalue(), "image/png")}, format="multipart")
            self.assertEqual(response.status_code, 201, response.data)
            attachment = response.data["id"]
            path = API + "attachments/" + attachment + "/"
            self.act({"type": "message", "user": str(self.b.pk), "text": "", "attachment": attachment})
            self.client.force_authenticate(self.b)
            self.assertEqual(self.client.get(path).status_code, 200)
            self.act({"type": "message", "user": str(self.a.pk), "text": "", "attachment": attachment}, 400)
            self.client.force_authenticate(self.e)
            self.assertEqual(self.client.get(path).status_code, 404)
            self.client.force_authenticate(None)
            self.assertEqual(self.client.get(path).status_code, 404)
            self.client.force_authenticate(self.a)
            post = self.act({"type": "hub-save", "category": "screenshot", "game": "first", "title": "My screenshot", "body": "", "attachment": attachment})["result"]["id"]
            self.client.force_authenticate(None)
            self.assertEqual(self.client.get(path).status_code, 200)
            self.client.force_authenticate(self.staff)
            self.act({"type": "hub-moderate", "post": post, "hidden": True})
            self.client.force_authenticate(None)
            self.assertEqual(self.client.get(path).status_code, 404)


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class SecurityTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user("alice", "alice@example.test", PASSWORD)
        self.client = APIClient()
        self.client.force_login(self.user)

    def action(self, mode, status=200, **values):
        response = self.client.post(API + "security/", {"mode": mode, **values}, format="json")
        self.assertEqual(response.status_code, status, response.data)
        return response.data

    def enable(self):
        setup = self.action("totp-setup", password=PASSWORD)
        otp = totp(setup["secret"], int(time.time()) // 30)
        result = self.action("totp-enable", password=PASSWORD, otp=otp)
        self.user.refresh_from_db()
        return setup, result, otp

    def emailed_token(self):
        url = next(line for line in mail.outbox[-1].body.splitlines() if line.startswith("http"))
        return parse_qs(urlparse(url).query)["token"][0]

    def test_totp_rfc_vector(self):
        secret = base64.b32encode(b"12345678901234567890").decode()
        self.assertEqual(totp(secret, 59 // 30, digits=8), "94287082")

    def test_enable_totp_secret_encrypted_and_no_secret_in_snapshot(self):
        setup, result, otp = self.enable()
        row = AccountSecurity.objects.get(user=self.user)
        self.assertNotIn(setup["secret"], row.secret)
        self.assertEqual(cipher().decrypt(row.secret.encode()).decode(), setup["secret"])
        for code in result["backupCodes"]:
            self.assertNotIn(code, str(row.backup_hashes))
        self.assertNotIn(setup["secret"], str(self.client.get(API + "snapshot/").data))
        self.assertEqual(len(result["backupCodes"]), 8)

    def test_login_requires_otp_replay_fails_backup_is_single_use(self):
        _, result, otp = self.enable()
        self.client.logout()
        def login(code=""):
            return self.client.post(API + "account/", {"mode": "login", "login": "alice", "password": PASSWORD, "otp": code}, format="json")
        self.assertEqual(login().status_code, 400)
        self.assertEqual(login(otp).status_code, 400)
        backup = result["backupCodes"][0]
        self.assertEqual(login(backup).status_code, 200)
        self.client.logout()
        self.assertEqual(login(backup).status_code, 400)

    def test_old_jwt_invalidated_and_legacy_login_cannot_bypass_totp(self):
        old = self.client.post("/api/v1/auth/login/", {"username": "alice", "password": PASSWORD}, format="json").data
        _, result, _ = self.enable()
        token_client = APIClient()
        token_client.credentials(HTTP_AUTHORIZATION="Bearer " + old["access"])
        self.assertEqual(token_client.get("/api/v1/auth/me/").status_code, 401)
        self.assertEqual(APIClient().post("/api/v1/auth/login/refresh/", {"refresh": old["refresh"]}, format="json").status_code, 401)
        self.assertEqual(APIClient().post("/api/v1/auth/login/", {"username": "alice", "password": PASSWORD}, format="json").status_code, 401)
        response = APIClient().post("/api/v1/auth/login/", {"username": "alice", "password": PASSWORD, "otp": result["backupCodes"][0]}, format="json")
        self.assertEqual(response.status_code, 200, response.data)

    def test_email_verification_one_time_and_token_not_returned_to_browser(self):
        result = self.action("send-verification")
        token = self.emailed_token()
        self.assertNotIn(token, str(result))
        self.assertNotIn(token, str(list(AccountToken.objects.values())))
        self.action("verify-email", token=token)
        self.user.refresh_from_db()
        self.assertTrue(self.user.is_email_verified)
        self.action("verify-email", status=400, token=token)

    def test_email_reset_invalidates_sessions_and_requires_2fa(self):
        _, result, _ = self.enable()
        self.client.logout()
        self.action("request-reset", login="alice")
        token = self.emailed_token()
        self.action("reset-email", status=400, token=token, password="New-strong-password-43")
        self.action("reset-email", token=token, password="New-strong-password-43", otp=result["backupCodes"][0])
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("New-strong-password-43"))
        self.assertTrue(AccountSecurity.objects.get(user=self.user).enabled)
        self.action("reset-email", status=400, token=token, password="Another-password-44")

    def test_expired_email_and_unknown_user_have_no_privileged_effect(self):
        self.action("request-reset", login="alice")
        token = self.emailed_token()
        AccountToken.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
        self.action("reset-email", status=400, token=token, password="New-strong-password-43")
        self.action("request-reset", login="missing")
        self.assertEqual(len(mail.outbox), 1)

    def test_session_revocation_is_owner_only_and_immediate(self):
        second = APIClient(); second.force_login(self.user)
        other_user = User.objects.create_user("other", password=PASSWORD)
        other_client = APIClient(); other_client.force_login(other_user)
        foreign = AccountDevice.objects.get(user=other_user)
        self.action("revoke-device", status=400, password=PASSWORD, device=str(foreign.pk))
        device = AccountDevice.objects.get(session_key=second.session.session_key)
        self.action("revoke-device", password=PASSWORD, device=str(device.pk))
        self.assertIsNone(second.get(API + "snapshot/").data["state"]["active"])
        self.assertEqual(self.client.get(API + "snapshot/").data["state"]["active"], str(self.user.pk))

    def test_admin_login_renders_otp_and_checks_it(self):
        self.user.is_staff = True; self.user.save()
        _, result, _ = self.enable()
        c = APIClient()
        self.assertContains(c.get("/admin/login/"), 'name="otp"')
        failed = c.post("/admin/login/", {"username": "alice", "password": PASSWORD, "next": "/admin/"})
        self.assertEqual(failed.status_code, 200)
        success = c.post("/admin/login/", {"username": "alice", "password": PASSWORD, "otp": result["backupCodes"][0], "next": "/admin/"})
        self.assertEqual(success.status_code, 302)

    def test_rejected_password_attempts_count_across_new_clients(self):
        for _ in range(10):
            response = APIClient().post(API + "account/", {"mode": "login", "login": "alice", "password": "bad"}, format="json")
            self.assertEqual(response.status_code, 400)
        self.assertEqual(AuthenticationWindow.objects.get().count, 10)
        response = APIClient().post(API + "account/", {"mode": "login", "login": "alice", "password": PASSWORD}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_security_mutations_require_csrf_even_while_anonymous(self):
        client = APIClient(enforce_csrf_checks=True)
        self.assertEqual(client.post(API + "security/", {"mode": "request-reset", "login": "alice"}, format="json").status_code, 403)
