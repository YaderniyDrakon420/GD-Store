from decimal import Decimal

from apps.accounts.models import Friendship
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.catalog.models import Game
from apps.library.models import LibraryEntry

from .models import CartItem, Order, PromoCode

User = get_user_model()


def make_game(title="Test Game", price="10.00", published=True):
    return Game.objects.create(
        title=title,
        slug=title.lower().replace(" ", "-"),
        price=Decimal(price),
        is_published=published,
    )


class CartTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="buyer", password="pass12345")
        self.client.force_authenticate(self.user)
        self.game = make_game()

    def test_add_and_list_cart(self):
        resp = self.client.post("/api/v1/store/cart/", {"game": str(self.game.id)})
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(CartItem.objects.filter(user=self.user).count(), 1)

        resp = self.client.get("/api/v1/store/cart/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

    def test_adding_same_game_twice_is_idempotent(self):
        # Повторное добавление той же игры не создаёт вторую позицию и не считается ошибкой.
        self.client.post("/api/v1/store/cart/", {"game": str(self.game.id)})
        resp = self.client.post("/api/v1/store/cart/", {"game": str(self.game.id)})
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(CartItem.objects.filter(user=self.user).count(), 1)

    def test_cannot_add_already_owned_game(self):
        LibraryEntry.objects.create(user=self.user, game=self.game)
        resp = self.client.post("/api/v1/store/cart/", {"game": str(self.game.id)})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)


class CheckoutTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="buyer", password="pass12345")
        self.friend = User.objects.create_user(username="friend", password="pass12345")
        Friendship.objects.create(
            from_user=self.user,
            to_user=self.friend,
            status="accepted",
     )
        self.client.force_authenticate(self.user)
        self.game_a = make_game("Game A", "20.00")
        self.game_b = make_game("Game B", "30.00")
        CartItem.objects.create(user=self.user, game=self.game_a)
        CartItem.objects.create(user=self.user, game=self.game_b)

    def test_checkout_creates_order_and_empties_cart(self):
        resp = self.client.post("/api/v1/store/cart/checkout/")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Decimal(resp.data["total"]), Decimal("50.00"))
        self.assertEqual(CartItem.objects.filter(user=self.user).count(), 0)
        order = Order.objects.get(id=resp.data["id"])
        self.assertEqual(order.status, Order.STATUS_PENDING)
        self.assertIsNotNone(order.expires_at)
        self.assertEqual(order.items.count(), 2)

    def test_checkout_empty_cart_rejected(self):
        CartItem.objects.filter(user=self.user).delete()
        resp = self.client.post("/api/v1/store/cart/checkout/")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_checkout_with_valid_promo_applies_discount(self):
        promo = PromoCode.objects.create(code="SALE10", discount_percent=10)
        resp = self.client.post("/api/v1/store/cart/checkout/", {"promo_code": "SALE10"})
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Decimal(resp.data["subtotal"]), Decimal("50.00"))
        self.assertEqual(Decimal(resp.data["discount_total"]), Decimal("5.00"))
        self.assertEqual(Decimal(resp.data["total"]), Decimal("45.00"))
        promo.refresh_from_db()
        self.assertEqual(promo.times_used, 1)

    def test_checkout_with_invalid_promo_rejected(self):
        resp = self.client.post("/api/v1/store/cart/checkout/", {"promo_code": "NOPE"})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_checkout_expired_promo_rejected(self):
        PromoCode.objects.create(
            code="OLD", discount_percent=50, valid_until=timezone.now() - timezone.timedelta(days=1)
        )
        resp = self.client.post("/api/v1/store/cart/checkout/", {"promo_code": "OLD"})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_checkout_as_gift_sets_recipient(self):
        resp = self.client.post("/api/v1/store/cart/checkout/", {"recipient_username": "friend"})
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp.data["recipient"], "friend")
        self.assertTrue(resp.data["is_gift"])

    def test_checkout_gift_to_self_rejected(self):
        resp = self.client.post("/api/v1/store/cart/checkout/", {"recipient_username": "buyer"})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_checkout_skips_games_recipient_already_owns(self):
        LibraryEntry.objects.create(user=self.friend, game=self.game_a)
        resp = self.client.post("/api/v1/store/cart/checkout/", {"recipient_username": "friend"})
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(len(resp.data["items"]), 1)
        self.assertEqual(resp.data["items"][0]["game"]["id"], str(self.game_b.id))


class OrderActionTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="buyer", password="pass12345")
        self.client.force_authenticate(self.user)
        self.game = make_game()
        CartItem.objects.create(user=self.user, game=self.game)
        resp = self.client.post("/api/v1/store/cart/checkout/")
        self.order_id = resp.data["id"]

    def test_cancel_pending_order(self):
        resp = self.client.post(f"/api/v1/store/orders/{self.order_id}/cancel/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["status"], Order.STATUS_CANCELLED)

    def test_cannot_cancel_twice(self):
        self.client.post(f"/api/v1/store/orders/{self.order_id}/cancel/")
        resp = self.client.post(f"/api/v1/store/orders/{self.order_id}/cancel/")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_cannot_refund_unpaid_order(self):
        resp = self.client.post(f"/api/v1/store/orders/{self.order_id}/refund/")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_refund_paid_order_removes_library_entry(self):
        order = Order.objects.get(id=self.order_id)
        order.status = Order.STATUS_PAID
        order.save(update_fields=["status"])
        LibraryEntry.objects.create(user=self.user, game=self.game)

        resp = self.client.post(f"/api/v1/store/orders/{self.order_id}/refund/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["status"], Order.STATUS_REFUNDED)
        self.assertFalse(LibraryEntry.objects.filter(user=self.user, game=self.game).exists())


from django.test import override_settings


@override_settings(PAYMENT_WEBHOOK_SECRET="promo-test-secret")
class PromoReservationTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="promo-buyer", password="pass12345")
        self.client.force_authenticate(self.user)
        self.game = make_game("Promo Game", "20.00")
        self.promo = PromoCode.objects.create(code="ONCE", discount_percent=50, max_uses=1)

    def checkout(self):
        CartItem.objects.get_or_create(user=self.user, game=self.game)
        response = self.client.post("/api/v1/store/cart/checkout/", {"promo_code": "ONCE"})
        self.assertEqual(response.status_code, 201, response.data)
        return Order.objects.get(pk=response.data["id"])

    def payment(self, order):
        from apps.payments.models import Payment
        response = self.client.post("/api/v1/payments/create/", {"order_id": str(order.pk)})
        self.assertEqual(response.status_code, 201, response.data)
        return Payment.objects.get(order=order)

    def webhook(self, payment, incoming_status):
        import hashlib
        import hmac
        import json
        body = json.dumps({
            "provider_payment_id": payment.provider_payment_id, "status": incoming_status,
        }).encode()
        signature = hmac.new(b"promo-test-secret", body, hashlib.sha256).hexdigest()
        response = self.client.generic(
            "POST", "/api/v1/payments/webhook/", data=body,
            content_type="application/json", HTTP_X_SIGNATURE=signature,
        )
        self.assertEqual(response.status_code, 200, response.data)

    def expire(self, order):
        Order.objects.filter(pk=order.pk).update(expires_at=timezone.now() - timezone.timedelta(seconds=1))

    def assert_uses(self, expected):
        self.promo.refresh_from_db()
        self.assertEqual(self.promo.times_used, expected)

    def test_cancel_releases_once_and_code_can_be_used_again(self):
        order = self.checkout()
        self.assert_uses(1)
        url = f"/api/v1/store/orders/{order.pk}/cancel/"
        self.assertEqual(self.client.post(url).status_code, 200)
        self.assert_uses(0)
        self.assertEqual(self.client.post(url).status_code, 400)
        self.assert_uses(0)
        self.checkout()
        self.assert_uses(1)

    def test_failed_payment_and_retry_keep_one_reservation(self):
        order = self.checkout()
        payment = self.payment(order)
        self.webhook(payment, "failed")
        self.assert_uses(1)
        self.payment(order)
        self.assert_uses(1)
        order.refresh_from_db()
        self.assertEqual(order.status, Order.STATUS_PENDING)

    def test_cleanup_releases_once_including_exact_deadline(self):
        from django.core.management import call_command
        from unittest.mock import patch
        from io import StringIO
        order = self.checkout()
        deadline = timezone.now()
        Order.objects.filter(pk=order.pk).update(expires_at=deadline)
        with patch("apps.store.services.timezone.now", return_value=deadline):
            call_command("expire_stale_orders", stdout=StringIO())
            call_command("expire_stale_orders", stdout=StringIO())
        self.assert_uses(0)
        order.refresh_from_db()
        self.assertEqual(order.status, Order.STATUS_EXPIRED)

    def test_create_payment_for_expired_order_releases_reservation(self):
        order = self.checkout()
        self.expire(order)
        response = self.client.post("/api/v1/payments/create/", {"order_id": str(order.pk)})
        self.assertEqual(response.status_code, 400)
        self.assert_uses(0)

    def test_duplicate_failed_webhook_after_expiry_releases_reservation(self):
        order = self.checkout()
        payment = self.payment(order)
        self.webhook(payment, "failed")
        self.expire(order)
        self.webhook(payment, "failed")
        self.webhook(payment, "failed")
        self.assert_uses(0)
        order.refresh_from_db()
        self.assertEqual(order.status, Order.STATUS_EXPIRED)

    def test_checkout_reclaims_expired_reservation_without_scheduled_command(self):
        first = self.checkout()
        self.expire(first)
        second = self.checkout()
        self.assertNotEqual(first.pk, second.pk)
        self.assert_uses(1)
        first.refresh_from_db()
        self.assertEqual(first.status, Order.STATUS_EXPIRED)

    def test_live_reservation_blocks_second_checkout_without_deleting_cart(self):
        self.checkout()
        CartItem.objects.create(user=self.user, game=self.game)
        response = self.client.post("/api/v1/store/cart/checkout/", {"promo_code": "ONCE"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Order.objects.filter(user=self.user).count(), 1)
        self.assertTrue(CartItem.objects.filter(user=self.user, game=self.game).exists())
        self.assert_uses(1)

    def test_success_and_refund_do_not_return_consumed_use(self):
        order = self.checkout()
        payment = self.payment(order)
        self.webhook(payment, "succeeded")
        self.assert_uses(1)
        self.assertEqual(self.client.post(f"/api/v1/store/orders/{order.pk}/refund/").status_code, 200)
        self.webhook(payment, "succeeded")
        self.webhook(payment, "failed")
        self.assert_uses(1)

    def test_late_success_cannot_consume_another_orders_reservation(self):
        first = self.checkout()
        first_payment = self.payment(first)
        self.expire(first)
        second = self.checkout()
        self.webhook(first_payment, "succeeded")
        self.assert_uses(1)
        self.assertTrue(first_payment.attempts.get().review_required)
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual(first.status, Order.STATUS_EXPIRED)
        self.assertEqual(second.status, Order.STATUS_PENDING)
        self.assertFalse(LibraryEntry.objects.filter(user=self.user, game=self.game).exists())
        self.webhook(self.payment(second), "succeeded")
        self.assert_uses(1)
        self.assertEqual(LibraryEntry.objects.filter(user=self.user, game=self.game).count(), 1)

    def test_transaction_error_rolls_back_reservation_and_preserves_cart(self):
        from unittest.mock import patch
        CartItem.objects.create(user=self.user, game=self.game)
        with patch("apps.store.views.OrderItem.objects.bulk_create", side_effect=RuntimeError("test rollback")):
            with self.assertRaisesMessage(RuntimeError, "test rollback"):
                self.client.post("/api/v1/store/cart/checkout/", {"promo_code": "ONCE"})
        self.assert_uses(0)
        self.assertFalse(Order.objects.filter(user=self.user).exists())
        self.assertTrue(CartItem.objects.filter(user=self.user, game=self.game).exists())

    def test_invalid_counter_does_not_cancel_order_or_go_negative(self):
        order = self.checkout()
        PromoCode.objects.filter(pk=self.promo.pk).update(times_used=0)
        response = self.client.post(f"/api/v1/store/orders/{order.pk}/cancel/")
        self.assertEqual(response.status_code, 400)
        order.refresh_from_db()
        self.assertEqual(order.status, Order.STATUS_PENDING)
        self.assert_uses(0)


class PromoCounterMigrationTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create(username="legacy-promo-user")

    def migrate_counters(self):
        from importlib import import_module
        from types import SimpleNamespace
        from django.db import connection
        from django.db.migrations.executor import MigrationExecutor
        apps = MigrationExecutor(connection).loader.project_state([
            ("store", "0002_promocode_alter_cartitem_options_alter_order_options_and_more"),
        ]).apps
        migration = import_module("apps.store.migrations.0003_release_legacy_promo_reservations")
        migration.release_legacy_reservations(apps, SimpleNamespace(connection=connection))

    def test_old_closed_orders_are_released_paid_and_pending_uses_remain(self):
        promo = PromoCode.objects.create(code="LEGACY", discount_percent=10, times_used=7)
        for state in ("pending", "paid", "refunded", "cancelled", "expired", "failed"):
            Order.objects.create(user=self.user, total=Decimal("9.00"), promo_code=promo, status=state)
        # Extra unattributed use remains untouched (e.g. old deleted order).
        self.migrate_counters()
        promo.refresh_from_db()
        self.assertEqual(promo.times_used, 4)

    def test_inconsistent_counter_stops_before_any_counter_changes(self):
        promo = PromoCode.objects.create(code="BROKEN", discount_percent=10, times_used=0)
        Order.objects.create(user=self.user, total=Decimal("9.00"), promo_code=promo, status="cancelled")
        with self.assertRaisesMessage(RuntimeError, "inconsistent"):
            self.migrate_counters()
        promo.refresh_from_db()
        self.assertEqual(promo.times_used, 0)

    def test_pending_legacy_reservation_without_expiry_gets_grace_period(self):
        promo = PromoCode.objects.create(code="NULLTTL", discount_percent=10, times_used=1)
        order = Order.objects.create(user=self.user, total=Decimal("9.00"), promo_code=promo)
        Order.objects.filter(pk=order.pk).update(expires_at=None)
        before = timezone.now()
        self.migrate_counters()
        order.refresh_from_db()
        self.assertGreaterEqual(order.expires_at, before + timezone.timedelta(minutes=30))


from django.test import TransactionTestCase, skipUnlessDBFeature


class PromoConcurrencyTests(TransactionTestCase):
    """Real independent DB connections; SQLite deliberately skips these tests."""

    def race(self, actions):
        from concurrent.futures import ThreadPoolExecutor
        from threading import Barrier
        from django.db import connections
        from rest_framework.test import APIClient
        barrier = Barrier(len(actions))

        def run(action):
            user, url, payload = action
            client = APIClient()
            client.force_authenticate(user)
            try:
                barrier.wait(timeout=10)
                response = client.post(url, payload)
                return response.status_code
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=len(actions)) as executor:
            futures = [executor.submit(run, action) for action in actions]
            return [future.result(timeout=30) for future in futures]

    @skipUnlessDBFeature("has_select_for_update")
    def test_two_checkouts_cannot_reserve_the_last_use_twice(self):
        promo = PromoCode.objects.create(code="LAST", discount_percent=10, max_uses=1)
        actions = []
        for index in range(2):
            user = get_user_model().objects.create(username=f"parallel-{index}")
            game = make_game(f"Parallel Game {index}")
            CartItem.objects.create(user=user, game=game)
            actions.append((user, "/api/v1/store/cart/checkout/", {"promo_code": "LAST"}))
        self.assertEqual(sorted(self.race(actions)), [201, 400])
        promo.refresh_from_db()
        self.assertEqual(promo.times_used, 1)
        self.assertEqual(Order.objects.filter(promo_code=promo).count(), 1)
        self.assertEqual(CartItem.objects.count(), 1)

    @skipUnlessDBFeature("has_select_for_update")
    def test_concurrent_cancellations_release_only_once(self):
        user = get_user_model().objects.create(username="parallel-cancel")
        promo = PromoCode.objects.create(code="CANCEL", discount_percent=10, times_used=1, max_uses=1)
        order = Order.objects.create(user=user, total=Decimal("9.00"), promo_code=promo)
        action = (user, f"/api/v1/store/orders/{order.pk}/cancel/", {})
        self.assertEqual(sorted(self.race([action, action])), [200, 400])
        promo.refresh_from_db()
        order.refresh_from_db()
        self.assertEqual(promo.times_used, 0)
        self.assertEqual(order.status, Order.STATUS_CANCELLED)


class PurchaseConcurrencyTests(TransactionTestCase):
    """Independent connections verify ownership serialization on SQL Server."""
    def race(self, actions):
        return PromoConcurrencyTests.race(self, actions)

    @skipUnlessDBFeature("has_select_for_update")
    def test_two_buyers_gifting_same_game_have_only_one_pending_order(self):
        recipient = get_user_model().objects.create(username="shared-recipient")
        game = make_game("Shared Gift")
        actions = []
        for index in range(2):
            buyer = get_user_model().objects.create(username=f"shared-buyer-{index}")
            Friendship.objects.create(from_user=buyer, to_user=recipient, status="accepted")
            CartItem.objects.create(user=buyer, game=game)
            actions.append((buyer, "/api/v1/store/cart/checkout/", {"recipient_username": recipient.username}))
        self.assertEqual(sorted(self.race(actions)), [201, 409])
        self.assertEqual(Order.objects.filter(recipient=recipient).count(), 1)
        self.assertEqual(CartItem.objects.count(), 1)

    @skipUnlessDBFeature("has_select_for_update")
    def test_reciprocal_gifts_do_not_deadlock(self):
        first = get_user_model().objects.create(username="reciprocal-a")
        second = get_user_model().objects.create(username="reciprocal-b")
        Friendship.objects.create(from_user=first, to_user=second, status="accepted")
        CartItem.objects.create(user=first, game=make_game("Gift A"))
        CartItem.objects.create(user=second, game=make_game("Gift B"))
        actions = [(first, "/api/v1/store/cart/checkout/", {"recipient_username": second.username}),
                   (second, "/api/v1/store/cart/checkout/", {"recipient_username": first.username})]
        self.assertEqual(self.race(actions), [201, 201])
        self.assertEqual(Order.objects.count(), 2)

    @skipUnlessDBFeature("has_select_for_update")
    def test_two_legacy_successes_grant_once_and_record_second_for_review(self):
        from concurrent.futures import ThreadPoolExecutor
        from threading import Barrier
        from django.db import connections
        from apps.payments.models import Payment, PaymentAttempt
        from apps.payments.services import apply_webhook
        from .models import OrderItem
        recipient = get_user_model().objects.create(username="legacy-shared-recipient")
        game = make_game("Legacy Shared")
        attempt_ids = []
        for index in range(2):
            buyer = get_user_model().objects.create(username=f"legacy-shared-buyer-{index}")
            order = Order.objects.create(user=buyer, recipient=recipient, total=game.final_price)
            OrderItem.objects.create(order=order, game=game, price_at_purchase=game.final_price)
            provider_id = f"legacy-concurrent-{index}"
            payment = Payment.objects.create(order=order, amount=order.total, provider_payment_id=provider_id)
            PaymentAttempt.objects.create(payment=payment, provider="stripe", amount=order.total, provider_payment_id=provider_id)
            attempt_ids.append(provider_id)
        barrier = Barrier(2)

        def run(provider_id):
            try:
                barrier.wait(timeout=10)
                apply_webhook(provider_id, "succeeded", {"provider_payment_id": provider_id, "status": "succeeded"})
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(run, provider_id) for provider_id in attempt_ids]
            for future in futures:
                future.result(timeout=30)
        self.assertEqual(Order.objects.filter(status=Order.STATUS_PAID).count(), 1)
        self.assertEqual(PaymentAttempt.objects.filter(status=Payment.STATUS_SUCCEEDED).count(), 2)
        self.assertEqual(PaymentAttempt.objects.filter(review_required=True, review_reason="already_owned").count(), 1)
        self.assertEqual(LibraryEntry.objects.filter(user=recipient, game=game).count(), 1)


class CartConfirmationTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="confirmed-cart", password="pass12345")
        self.client.force_authenticate(self.user)
        self.game = make_game("Confirmed Game", "10.00")
        CartItem.objects.create(user=self.user, game=self.game)

    def summary(self):
        response = self.client.get("/api/v1/store/cart/summary/")
        self.assertEqual(response.status_code, 200)
        return response.data

    def test_full_cart_summary_and_order_include_all_21_items(self):
        for index in range(20):
            CartItem.objects.create(user=self.user, game=make_game(f"Confirmed {index}", "10.00"))
        data = self.summary()
        self.assertEqual(len(data["results"]), 21)
        self.assertEqual(data["count"], 21)
        self.assertEqual(Decimal(data["total"]), Decimal("210.00"))
        response = self.client.post("/api/v1/store/cart/checkout/", {"checkout_token": data["checkout_token"]})
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(len(response.data["items"]), 21)
        self.assertEqual(Decimal(response.data["total"]), Decimal(data["total"]))

    def test_changed_price_rejects_confirmation_and_preserves_cart(self):
        token = self.summary()["checkout_token"]
        Game.objects.filter(pk=self.game.pk).update(price=Decimal("99.00"))
        response = self.client.post("/api/v1/store/cart/checkout/", {"checkout_token": token})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(CartItem.objects.filter(user=self.user).count(), 1)
        self.assertFalse(Order.objects.filter(user=self.user).exists())

    def test_added_position_requires_new_confirmation(self):
        token = self.summary()["checkout_token"]
        CartItem.objects.create(user=self.user, game=make_game("New Position"))
        self.assertEqual(self.client.post("/api/v1/store/cart/checkout/", {"checkout_token": token}).status_code, 409)
        self.assertEqual(CartItem.objects.filter(user=self.user).count(), 2)

    def test_tampered_confirmation_is_rejected_without_creating_order(self):
        self.assertEqual(self.client.post("/api/v1/store/cart/checkout/", {"checkout_token": "tampered"}).status_code, 409)
        self.assertFalse(Order.objects.filter(user=self.user).exists())

    def test_confirmation_cannot_be_used_by_another_user(self):
        token = self.summary()["checkout_token"]
        other = get_user_model().objects.create(username="other-confirmed-cart")
        CartItem.objects.create(user=other, game=self.game)
        self.client.force_authenticate(other)
        self.assertEqual(self.client.post("/api/v1/store/cart/checkout/", {"checkout_token": token}).status_code, 409)
        self.assertFalse(Order.objects.filter(user=other).exists())

    def test_withdrawn_game_is_rejected_even_without_confirmation(self):
        Game.objects.filter(pk=self.game.pk).update(is_published=False)
        self.assertFalse(self.summary()["can_checkout"])
        self.assertEqual(self.client.post("/api/v1/store/cart/checkout/").status_code, 409)
        self.assertFalse(Order.objects.filter(user=self.user).exists())

    def test_new_ownership_invalidates_confirmation(self):
        token = self.summary()["checkout_token"]
        LibraryEntry.objects.create(user=self.user, game=self.game)
        self.assertFalse(self.summary()["can_checkout"])
        self.assertEqual(self.client.post("/api/v1/store/cart/checkout/", {"checkout_token": token}).status_code, 409)
        self.assertTrue(CartItem.objects.filter(user=self.user).exists())

    def test_order_response_uses_public_request_host_for_media(self):
        Game.objects.filter(pk=self.game.pk).update(cover_image="games/covers/test.jpg")
        summary = self.client.get("/api/v1/store/cart/summary/", HTTP_HOST="localhost:5173").data
        response = self.client.post("/api/v1/store/cart/checkout/", {"checkout_token": summary["checkout_token"]}, HTTP_HOST="localhost:5173")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["items"][0]["game"]["cover_image"], "http://localhost:5173/media/games/covers/test.jpg")

    def test_expired_confirmation_requires_refresh(self):
        from unittest.mock import patch
        import time
        token = self.summary()["checkout_token"]
        with patch("django.core.signing.time.time", return_value=time.time() + 601):
            response = self.client.post("/api/v1/store/cart/checkout/", {"checkout_token": token})
        self.assertEqual(response.status_code, 409)
