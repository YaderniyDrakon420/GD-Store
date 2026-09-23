import hashlib
import hmac
import json
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import Friendship
from apps.catalog.models import Game
from apps.library.models import LibraryEntry
from apps.store.models import CartItem, Order

from .models import Payment, PaymentAttempt


User = get_user_model()
TEST_WEBHOOK_SECRET = "testsecret"


def sign(secret, body_bytes):
    return hmac.new(
        secret.encode("utf-8"),
        body_bytes,
        hashlib.sha256,
    ).hexdigest()


@override_settings(PAYMENT_WEBHOOK_SECRET=TEST_WEBHOOK_SECRET)
class PaymentsTestCase(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="buyer",
            password="pass12345",
        )
        self.friend = User.objects.create_user(
            username="friend",
            password="pass12345",
        )
        self.other = User.objects.create_user(
            username="stranger",
            password="pass12345",
        )

        Friendship.objects.create(
            from_user=self.user,
            to_user=self.friend,
            status="accepted",
        )

        self.game = Game.objects.create(
            title="Game",
            slug="game",
            price=Decimal("15.00"),
            is_published=True,
        )

        self.client.force_authenticate(self.user)
        CartItem.objects.create(user=self.user, game=self.game)

        response = self.client.post("/api/v1/store/cart/checkout/")
        self.assertEqual(
            response.status_code,
            status.HTTP_201_CREATED,
            response.data,
        )
        self.order = Order.objects.get(id=response.data["id"])

    def create_payment(self, order=None):
        order = order if order is not None else self.order

        response = self.client.post(
            "/api/v1/payments/create/",
            {"order_id": str(order.id)},
        )
        self.assertEqual(
            response.status_code,
            status.HTTP_201_CREATED,
            response.data,
        )

        return Payment.objects.get(order=order)

    def post_webhook(self, payload):
        body = json.dumps(payload).encode("utf-8")

        return self.client.generic(
            "POST",
            "/api/v1/payments/webhook/",
            data=body,
            content_type="application/json",
            HTTP_X_SIGNATURE=sign(TEST_WEBHOOK_SECRET, body),
        )

    def assert_payment_unchanged(self, payment):
        self.order.refresh_from_db()
        payment.refresh_from_db()

        self.assertEqual(self.order.status, Order.STATUS_PENDING)
        self.assertEqual(payment.status, Payment.STATUS_CREATED)
        self.assertEqual(payment.raw_payload, {})
        self.assertFalse(
            LibraryEntry.objects.filter(
                user=self.user,
                game=self.game,
            ).exists()
        )

    def test_create_payment_for_own_pending_order(self):
        response = self.client.post(
            "/api/v1/payments/create/",
            {"order_id": str(self.order.id)},
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertIn("checkout_url", response.data)
        self.assertEqual(
            Payment.objects.filter(order=self.order).count(),
            1,
        )

    def test_create_payment_for_someone_elses_order_is_404(self):
        self.client.force_authenticate(self.other)

        response = self.client.post(
            "/api/v1/payments/create/",
            {"order_id": str(self.order.id)},
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertFalse(
            Payment.objects.filter(order=self.order).exists()
        )

    def test_create_payment_reuses_existing_non_succeeded_payment(self):
        first_payment = self.create_payment()
        second_payment = self.create_payment()

        self.assertEqual(first_payment.pk, second_payment.pk)
        self.assertEqual(
            Payment.objects.filter(order=self.order).count(),
            1,
        )

    def test_webhook_success_marks_order_paid_and_grants_library(self):
        payment = self.create_payment()

        response = self.post_webhook({
            "provider_payment_id": payment.provider_payment_id,
            "status": "succeeded",
        })

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.order.refresh_from_db()
        payment.refresh_from_db()

        self.assertEqual(self.order.status, Order.STATUS_PAID)
        self.assertEqual(payment.status, Payment.STATUS_SUCCEEDED)
        self.assertTrue(
            LibraryEntry.objects.filter(
                user=self.user,
                game=self.game,
            ).exists()
        )

    def test_webhook_is_idempotent(self):
        payment = self.create_payment()
        payload = {
            "provider_payment_id": payment.provider_payment_id,
            "status": "succeeded",
        }

        first_response = self.post_webhook(payload)
        second_response = self.post_webhook(payload)

        self.assertEqual(first_response.status_code, status.HTTP_200_OK)
        self.assertEqual(second_response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            LibraryEntry.objects.filter(
                user=self.user,
                game=self.game,
            ).count(),
            1,
        )

        self.order.refresh_from_db()
        payment.refresh_from_db()

        self.assertEqual(self.order.status, Order.STATUS_PAID)
        self.assertEqual(payment.status, Payment.STATUS_SUCCEEDED)

    def test_webhook_gift_order_grants_recipient(self):
        game2 = Game.objects.create(
            title="Game 2",
            slug="game-2",
            price=Decimal("5.00"),
            is_published=True,
        )

        CartItem.objects.create(user=self.user, game=self.game)
        CartItem.objects.create(user=self.user, game=game2)

        checkout_response = self.client.post(
            "/api/v1/store/cart/checkout/",
            {"recipient_username": self.friend.username},
        )

        self.assertEqual(
            checkout_response.status_code,
            status.HTTP_201_CREATED,
            checkout_response.data,
        )

        gift_order = Order.objects.get(id=checkout_response.data["id"])
        payment = self.create_payment(gift_order)

        response = self.post_webhook({
            "provider_payment_id": payment.provider_payment_id,
            "status": "succeeded",
        })

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        gift_order.refresh_from_db()
        payment.refresh_from_db()

        self.assertEqual(gift_order.status, Order.STATUS_PAID)
        self.assertEqual(payment.status, Payment.STATUS_SUCCEEDED)

        for game in (self.game, game2):
            self.assertTrue(
                LibraryEntry.objects.filter(
                    user=self.friend,
                    game=game,
                ).exists()
            )
            self.assertFalse(
                LibraryEntry.objects.filter(
                    user=self.user,
                    game=game,
                ).exists()
            )

    def test_webhook_failed_keeps_order_pending(self):
        payment = self.create_payment()

        response = self.post_webhook({
            "provider_payment_id": payment.provider_payment_id,
            "status": "failed",
        })

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.order.refresh_from_db()
        payment.refresh_from_db()

        self.assertEqual(self.order.status, Order.STATUS_PENDING)
        self.assertEqual(payment.status, Payment.STATUS_FAILED)
        self.assertFalse(
            LibraryEntry.objects.filter(
                user=self.user,
                game=self.game,
            ).exists()
        )

    def test_webhook_rejects_bad_signature(self):
        payment = self.create_payment()
        body = json.dumps({
            "provider_payment_id": payment.provider_payment_id,
            "status": "succeeded",
        }).encode("utf-8")

        self.client.force_authenticate(user=None)

        response = self.client.generic(
            "POST",
            "/api/v1/payments/webhook/",
            data=body,
            content_type="application/json",
            HTTP_X_SIGNATURE="wrong",
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assert_payment_unchanged(payment)

    def test_webhook_accepts_correct_signature(self):
        payment = self.create_payment()

        # Провайдер не входит в аккаунт пользователя.
        self.client.force_authenticate(user=None)

        response = self.post_webhook({
            "provider_payment_id": payment.provider_payment_id,
            "status": "succeeded",
        })

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.order.refresh_from_db()
        payment.refresh_from_db()

        self.assertEqual(self.order.status, Order.STATUS_PAID)
        self.assertEqual(payment.status, Payment.STATUS_SUCCEEDED)
        self.assertTrue(
            LibraryEntry.objects.filter(
                user=self.user,
                game=self.game,
            ).exists()
        )

    def test_webhook_rejects_missing_secret(self):
        payment = self.create_payment()
        payload = {
            "provider_payment_id": payment.provider_payment_id,
            "status": "succeeded",
        }

        self.client.force_authenticate(user=None)

        # Даже подписанный запрос нельзя принять без серверного секрета.
        with override_settings(PAYMENT_WEBHOOK_SECRET=""):
            response = self.post_webhook(payload)

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assert_payment_unchanged(payment)

    def test_webhook_rejects_missing_signature(self):
        payment = self.create_payment()
        body = json.dumps({
            "provider_payment_id": payment.provider_payment_id,
            "status": "succeeded",
        }).encode("utf-8")

        self.client.force_authenticate(user=None)

        response = self.client.generic(
            "POST",
            "/api/v1/payments/webhook/",
            data=body,
            content_type="application/json",
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assert_payment_unchanged(payment)

    def test_webhook_rejects_incorrect_signature_without_grant(self):
        payment = self.create_payment()
        body = json.dumps({
            "provider_payment_id": payment.provider_payment_id,
            "status": "succeeded",
        }).encode("utf-8")

        self.client.force_authenticate(user=None)

        # Формат подписи правильный, но использован чужой секрет.
        response = self.client.generic(
            "POST",
            "/api/v1/payments/webhook/",
            data=body,
            content_type="application/json",
            HTTP_X_SIGNATURE=sign("incorrect-secret", body),
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assert_payment_unchanged(payment)
    def test_active_payment_keeps_checkout_url_and_first_webhook_valid(self):
        first = self.client.post(
            "/api/v1/payments/create/", {"order_id": str(self.order.id)}
        )
        self.assertEqual(first.status_code, status.HTTP_201_CREATED, first.data)
        payment = Payment.objects.get(order=self.order)
        original_id = payment.provider_payment_id
        original_updated_at = payment.updated_at
        second = self.client.post(
            "/api/v1/payments/create/", {"order_id": str(self.order.id)}
        )
        self.assertEqual(second.status_code, status.HTTP_201_CREATED, second.data)
        self.assertEqual(first.data["checkout_url"], second.data["checkout_url"])
        payment.refresh_from_db()
        self.assertEqual(payment.provider_payment_id, original_id)
        self.assertEqual(payment.updated_at, original_updated_at)
        response = self.post_webhook({
            "provider_payment_id": original_id, "status": "succeeded",
        })
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, Order.STATUS_PAID)
        self.assertEqual(LibraryEntry.objects.filter(
            user=self.user, game=self.game,
        ).count(), 1)

    def test_active_payment_request_does_not_rewrite_amount_or_payload(self):
        payment = self.create_payment()
        payment.raw_payload = {"audit_marker": "preserve"}
        payment.save(update_fields=["raw_payload"])
        original_amount = payment.amount
        repeated = self.create_payment()
        self.assertEqual(repeated.amount, original_amount)
        self.assertEqual(repeated.raw_payload, {"audit_marker": "preserve"})
        self.assertEqual(repeated.provider_payment_id, payment.provider_payment_id)

    def test_failed_attempt_still_allows_retry_and_success(self):
        payment = self.create_payment()
        response = self.post_webhook({
            "provider_payment_id": payment.provider_payment_id, "status": "failed",
        })
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        retried = self.create_payment()
        self.assertEqual(retried.pk, payment.pk)
        self.assertNotEqual(retried.provider_payment_id, payment.provider_payment_id)
        self.assertEqual(retried.status, Payment.STATUS_CREATED)
        response = self.post_webhook({
            "provider_payment_id": retried.provider_payment_id, "status": "succeeded",
        })
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, Order.STATUS_PAID)

    def test_failed_webhook_cannot_undo_success(self):
        payment = self.create_payment()
        success = {"provider_payment_id": payment.provider_payment_id, "status": "succeeded"}
        self.assertEqual(self.post_webhook(success).status_code, status.HTTP_200_OK)
        payment.refresh_from_db()
        updated_at = payment.updated_at
        response = self.post_webhook({
            "provider_payment_id": payment.provider_payment_id, "status": "failed",
        })
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payment.refresh_from_db()
        self.order.refresh_from_db()
        self.assertEqual(payment.status, Payment.STATUS_SUCCEEDED)
        self.assertEqual(payment.raw_payload, success)
        self.assertEqual(payment.updated_at, updated_at)
        self.assertEqual(self.order.status, Order.STATUS_PAID)
        self.assertTrue(LibraryEntry.objects.filter(user=self.user, game=self.game).exists())

    def test_late_webhooks_cannot_undo_refund(self):
        payment = self.create_payment()
        success = {"provider_payment_id": payment.provider_payment_id, "status": "succeeded"}
        self.assertEqual(self.post_webhook(success).status_code, status.HTTP_200_OK)
        refund = self.client.post(f"/api/v1/store/orders/{self.order.id}/refund/")
        self.assertEqual(refund.status_code, status.HTTP_200_OK, refund.data)
        payment.refresh_from_db()
        updated_at = payment.updated_at
        for incoming_status in ("succeeded", "failed", "succeeded"):
            with self.subTest(status=incoming_status):
                response = self.post_webhook({
                    "provider_payment_id": payment.provider_payment_id,
                    "status": incoming_status,
                })
                self.assertEqual(response.status_code, status.HTTP_200_OK)
                payment.refresh_from_db()
                self.order.refresh_from_db()
                self.assertEqual(payment.status, Payment.STATUS_REFUNDED)
                self.assertEqual(self.order.status, Order.STATUS_REFUNDED)
                self.assertEqual(payment.raw_payload, success)
                self.assertEqual(payment.updated_at, updated_at)
                self.assertFalse(LibraryEntry.objects.filter(
                    user=self.user, game=self.game,
                ).exists())
        recreate = self.client.post(
            "/api/v1/payments/create/", {"order_id": str(self.order.id)}
        )
        self.assertEqual(recreate.status_code, status.HTTP_400_BAD_REQUEST)

    def test_expired_order_cannot_reopen_active_payment(self):
        from datetime import timedelta
        from django.utils import timezone

        payment = self.create_payment()
        Order.objects.filter(pk=self.order.pk).update(
            expires_at=timezone.now() - timedelta(seconds=1),
        )
        response = self.client.post(
            "/api/v1/payments/create/", {"order_id": str(self.order.id)}
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        unchanged = Payment.objects.get(pk=payment.pk)
        self.assertEqual(unchanged.provider_payment_id, payment.provider_payment_id)
        self.assertEqual(unchanged.updated_at, payment.updated_at)
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, Order.STATUS_EXPIRED)

    def test_legacy_payment_without_provider_id_gets_stable_checkout(self):
        legacy = Payment.objects.create(order=self.order, amount=self.order.total)
        first = self.create_payment()
        second = self.create_payment()
        self.assertEqual(first.pk, legacy.pk)
        self.assertTrue(first.provider_payment_id)
        self.assertEqual(first.provider_payment_id, second.provider_payment_id)

    def fail_and_retry(self):
        first = self.create_payment()
        response = self.post_webhook({
            "provider_payment_id": first.provider_payment_id, "status": "failed",
        })
        self.assertEqual(response.status_code, 200)
        second = self.create_payment()
        return first.provider_payment_id, second.provider_payment_id

    def test_retry_preserves_failed_attempt_id_amount_and_payload(self):
        first_id, second_id = self.fail_and_retry()
        first = PaymentAttempt.objects.get(provider_payment_id=first_id)
        second = PaymentAttempt.objects.get(provider_payment_id=second_id)
        self.assertEqual(first.payment_id, second.payment_id)
        self.assertEqual(first.status, Payment.STATUS_FAILED)
        self.assertEqual(first.amount, Decimal("15.00"))
        self.assertEqual(first.raw_payload, {
            "provider_payment_id": first_id, "status": "failed",
        })
        self.assertEqual(second.status, Payment.STATUS_CREATED)
        self.assertEqual(second.raw_payload, {})
        self.create_payment()
        self.assertEqual(PaymentAttempt.objects.filter(payment=first.payment).count(), 2)

    def test_old_failed_notification_does_not_fail_current_attempt(self):
        first_id, second_id = self.fail_and_retry()
        response = self.post_webhook({"provider_payment_id": first_id, "status": "failed"})
        self.assertEqual(response.status_code, 200)
        payment = Payment.objects.get(order=self.order)
        self.assertEqual(payment.status, Payment.STATUS_CREATED)
        self.assertEqual(payment.provider_payment_id, second_id)
        self.assertEqual(payment.raw_payload, {})
        self.assertEqual(PaymentAttempt.objects.get(provider_payment_id=second_id).status,
                         Payment.STATUS_CREATED)

    def test_old_success_can_fulfill_order_without_losing_new_attempt(self):
        first_id, second_id = self.fail_and_retry()
        response = self.post_webhook({"provider_payment_id": first_id, "status": "succeeded"})
        self.assertEqual(response.status_code, 200)
        self.order.refresh_from_db()
        payment = Payment.objects.get(order=self.order)
        self.assertEqual(self.order.status, Order.STATUS_PAID)
        self.assertEqual(payment.provider_payment_id, first_id)
        self.assertFalse(payment.attempts.filter(review_required=True).exists())
        self.assertTrue(payment.attempts.filter(provider_payment_id=second_id).exists())
        response = self.post_webhook({"provider_payment_id": second_id, "status": "failed"})
        self.assertEqual(response.status_code, 200)
        payment.refresh_from_db()
        self.assertEqual(payment.status, Payment.STATUS_SUCCEEDED)
        self.assertEqual(payment.provider_payment_id, first_id)
        self.assertEqual(LibraryEntry.objects.filter(user=self.user, game=self.game).count(), 1)

    def test_two_successes_are_preserved_and_second_requires_review(self):
        first_id, second_id = self.fail_and_retry()
        for attempt_id in (second_id, first_id, first_id):
            self.assertEqual(self.post_webhook({
                "provider_payment_id": attempt_id, "status": "succeeded",
            }).status_code, 200)
        payment = Payment.objects.get(order=self.order)
        self.assertEqual(payment.provider_payment_id, second_id)
        self.assertEqual(payment.attempts.filter(status=Payment.STATUS_SUCCEEDED).count(), 2)
        first = payment.attempts.get(provider_payment_id=first_id)
        self.assertTrue(first.review_required)
        self.assertEqual(first.review_reason, "additional_success")
        self.assertEqual(LibraryEntry.objects.filter(user=self.user, game=self.game).count(), 1)
        response = self.client.post(f"/api/v1/store/orders/{self.order.id}/refund/")
        self.assertEqual(response.status_code, 409)
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, Order.STATUS_PAID)
        self.assertTrue(LibraryEntry.objects.filter(user=self.user, game=self.game).exists())
        recreate = self.client.post("/api/v1/payments/create/", {"order_id": str(self.order.pk)})
        self.assertEqual(recreate.status_code, 400)
        self.assertEqual(payment.attempts.count(), 2)

    def test_success_after_expiry_is_recorded_for_review_without_grant(self):
        from datetime import timedelta
        from django.utils import timezone

        payment = self.create_payment()
        Order.objects.filter(pk=self.order.pk).update(expires_at=timezone.now() - timedelta(seconds=1))
        payload = {"provider_payment_id": payment.provider_payment_id, "status": "succeeded"}
        self.assertEqual(self.post_webhook(payload).status_code, 200)
        self.assertEqual(self.post_webhook(payload).status_code, 200)
        payment.refresh_from_db()
        self.order.refresh_from_db()
        attempt = payment.attempts.get()
        self.assertEqual(payment.status, Payment.STATUS_SUCCEEDED)
        self.assertEqual(attempt.status, Payment.STATUS_SUCCEEDED)
        self.assertEqual(self.order.status, Order.STATUS_EXPIRED)
        self.assertTrue(attempt.review_required)
        self.assertEqual(attempt.raw_payload, payload)
        self.assertFalse(LibraryEntry.objects.filter(user=self.user, game=self.game).exists())

    def test_success_after_cancel_is_recorded_without_reopening_order(self):
        payment = self.create_payment()
        response = self.client.post(f"/api/v1/store/orders/{self.order.id}/cancel/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.post_webhook({
            "provider_payment_id": payment.provider_payment_id, "status": "succeeded",
        }).status_code, 200)
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, Order.STATUS_CANCELLED)
        attempt = payment.attempts.get()
        self.assertEqual(attempt.status, Payment.STATUS_SUCCEEDED)
        self.assertTrue(attempt.review_required)
        self.assertFalse(LibraryEntry.objects.filter(user=self.user, game=self.game).exists())

    def test_refund_preserves_attempt_and_its_terminal_status(self):
        payment = self.create_payment()
        self.assertEqual(self.post_webhook({
            "provider_payment_id": payment.provider_payment_id, "status": "succeeded",
        }).status_code, 200)
        self.assertEqual(self.client.post(
            f"/api/v1/store/orders/{self.order.id}/refund/",
        ).status_code, 200)
        for event in ("failed", "succeeded"):
            self.assertEqual(self.post_webhook({
                "provider_payment_id": payment.provider_payment_id, "status": event,
            }).status_code, 200)
        attempt = payment.attempts.get()
        self.assertEqual(attempt.status, Payment.STATUS_REFUNDED)
        self.assertFalse(attempt.review_required)

    def test_another_attempt_success_after_refund_requires_review(self):
        first_id, second_id = self.fail_and_retry()
        self.assertEqual(self.post_webhook({"provider_payment_id": second_id, "status": "succeeded"}).status_code, 200)
        self.assertEqual(self.client.post(f"/api/v1/store/orders/{self.order.id}/refund/").status_code, 200)
        self.assertEqual(self.post_webhook({"provider_payment_id": first_id, "status": "succeeded"}).status_code, 200)
        payment = Payment.objects.get(order=self.order)
        self.order.refresh_from_db()
        self.assertEqual(payment.status, Payment.STATUS_REFUNDED)
        self.assertEqual(self.order.status, Order.STATUS_REFUNDED)
        self.assertEqual(payment.attempts.get(provider_payment_id=second_id).status, Payment.STATUS_REFUNDED)
        self.assertTrue(payment.attempts.get(provider_payment_id=first_id).review_required)
        self.assertFalse(LibraryEntry.objects.filter(user=self.user, game=self.game).exists())

    def test_amount_changed_after_checkout_requires_review(self):
        payment = self.create_payment()
        Order.objects.filter(pk=self.order.pk).update(total=Decimal("99.00"))
        self.assertEqual(self.post_webhook({
            "provider_payment_id": payment.provider_payment_id, "status": "succeeded",
        }).status_code, 200)
        attempt = payment.attempts.get()
        self.assertEqual(attempt.amount, Decimal("15.00"))
        self.assertEqual(attempt.review_reason, "amount_mismatch")
        self.assertTrue(attempt.review_required)
        self.assertFalse(LibraryEntry.objects.filter(user=self.user, game=self.game).exists())

    def test_unknown_attempt_is_404_without_changing_current_payment(self):
        payment = self.create_payment()
        self.assertEqual(self.post_webhook({"provider_payment_id": "unknown", "status": "succeeded"}).status_code, 404)
        self.assert_payment_unchanged(payment)


class PaymentAttemptBackfillTests(APITestCase):
    def run_backfill(self):
        from importlib import import_module
        from types import SimpleNamespace
        from django.db import connection
        from django.db.migrations.executor import MigrationExecutor

        apps = MigrationExecutor(connection).loader.project_state([
            ("payments", "0003_paymentattempt"),
        ]).apps
        migration = import_module("apps.payments.migrations.0004_backfill_payment_attempts")
        migration.backfill_attempts(apps, SimpleNamespace(connection=connection))

    def make_legacy_payment(self, provider_id, payment_status=Payment.STATUS_CREATED):
        user, _ = User.objects.get_or_create(username="legacy-buyer")
        order = Order.objects.create(user=user, total=Decimal("12.50"))
        return Payment.objects.create(
            order=order, amount=Decimal("12.50"), provider_payment_id=provider_id,
            status=payment_status, raw_payload={"legacy": True},
        )

    def test_backfill_preserves_existing_statuses_ids_amounts_and_timestamps(self):
        originals = [self.make_legacy_payment(f"legacy-{s}", s) for s in (
            Payment.STATUS_CREATED, Payment.STATUS_FAILED,
            Payment.STATUS_SUCCEEDED, Payment.STATUS_REFUNDED,
        )]
        self.run_backfill()
        self.assertEqual(PaymentAttempt.objects.count(), 4)
        for original in originals:
            with self.subTest(status=original.status):
                attempt = PaymentAttempt.objects.get(payment=original)
                self.assertEqual(attempt.provider_payment_id, original.provider_payment_id)
                self.assertEqual(attempt.amount, original.amount)
                self.assertEqual(attempt.status, original.status)
                self.assertEqual(attempt.raw_payload, original.raw_payload)
                self.assertEqual(attempt.created_at, original.created_at)
                self.assertEqual(attempt.updated_at, original.updated_at)
                original.refresh_from_db()
                self.assertEqual(original.provider_payment_id, attempt.provider_payment_id)

    def test_backfill_skips_blank_ids_without_deleting_payment(self):
        original = self.make_legacy_payment("")
        self.run_backfill()
        self.assertEqual(PaymentAttempt.objects.count(), 0)
        self.assertTrue(Payment.objects.filter(pk=original.pk).exists())

    def test_backfill_rejects_ambiguous_ids_before_creating_attempts(self):
        self.make_legacy_payment("duplicate-id")
        self.make_legacy_payment("duplicate-id")
        with self.assertRaisesMessage(RuntimeError, "duplicate provider_payment_id"):
            self.run_backfill()
        self.assertEqual(PaymentAttempt.objects.count(), 0)
        self.assertEqual(Payment.objects.count(), 2)


@override_settings(PAYMENT_WEBHOOK_SECRET=TEST_WEBHOOK_SECRET)
class PurchaseOwnershipTests(APITestCase):
    def setUp(self):
        self.buyer = User.objects.create_user(username="owner-buyer", password="pass12345")
        self.other = User.objects.create_user(username="owner-other", password="pass12345")
        self.recipient = User.objects.create_user(username="owner-recipient", password="pass12345")
        for first, second in ((self.buyer, self.recipient), (self.other, self.recipient), (self.buyer, self.other)):
            Friendship.objects.create(from_user=first, to_user=second, status="accepted")
        self.game = Game.objects.create(title="Ownership", slug="ownership", price=Decimal("10.00"), is_published=True)
        self.client.force_authenticate(self.buyer)

    def checkout(self, buyer=None, recipient=None, extra=None):
        buyer = buyer or self.buyer
        self.client.force_authenticate(buyer)
        CartItem.objects.get_or_create(user=buyer, game=self.game)
        payload = dict(extra or {})
        if recipient:
            payload["recipient_username"] = recipient.username
        return self.client.post("/api/v1/store/cart/checkout/", payload)

    def legacy_order(self, recipient=None, games=None):
        from apps.store.models import OrderItem
        games = games or [self.game]
        total = sum((game.final_price for game in games), Decimal("0.00"))
        order = Order.objects.create(user=self.buyer, recipient=recipient, subtotal=total, total=total)
        for game in games:
            OrderItem.objects.create(order=order, game=game, price_at_purchase=game.final_price)
        return order

    def payment(self, order):
        response = self.client.post("/api/v1/payments/create/", {"order_id": str(order.pk)})
        self.assertEqual(response.status_code, 201, response.data)
        return Payment.objects.get(order=order)

    def success(self, payment):
        body = json.dumps({"provider_payment_id": payment.provider_payment_id, "status": "succeeded"}).encode()
        response = self.client.generic(
            "POST", "/api/v1/payments/webhook/", data=body,
            content_type="application/json", HTTP_X_SIGNATURE=sign(TEST_WEBHOOK_SECRET, body),
        )
        self.assertEqual(response.status_code, 200, response.data)

    def test_second_pending_checkout_is_rejected_without_spending_promo_or_cart(self):
        from apps.store.models import PromoCode
        promo = PromoCode.objects.create(code="DUP", discount_percent=10, max_uses=3)
        self.assertEqual(self.checkout(extra={"promo_code": "DUP"}).status_code, 201)
        self.assertEqual(self.checkout(extra={"promo_code": "DUP"}).status_code, 409)
        promo.refresh_from_db()
        self.assertEqual(promo.times_used, 1)
        self.assertEqual(Order.objects.filter(user=self.buyer).count(), 1)
        self.assertTrue(CartItem.objects.filter(user=self.buyer, game=self.game).exists())

    def test_two_buyers_cannot_open_same_gift_for_one_recipient(self):
        first = self.checkout(recipient=self.recipient)
        self.assertEqual(first.status_code, 201, first.data)
        second = self.checkout(buyer=self.other, recipient=self.recipient)
        self.assertEqual(second.status_code, 409, second.data)
        self.assertNotIn(str(first.data["id"]), str(second.data))
        self.assertTrue(CartItem.objects.filter(user=self.other, game=self.game).exists())

    def test_same_game_for_different_recipients_is_allowed(self):
        self.assertEqual(self.checkout(recipient=self.recipient).status_code, 201)
        self.assertEqual(self.checkout(recipient=self.other).status_code, 201)
        self.assertEqual(self.checkout().status_code, 201)

    def test_cancelled_order_does_not_block_new_checkout(self):
        first = self.checkout()
        self.assertEqual(first.status_code, 201)
        self.assertEqual(self.client.post(f"/api/v1/store/orders/{first.data['id']}/cancel/").status_code, 200)
        self.assertEqual(self.checkout().status_code, 201)

    def test_expired_reservation_does_not_block_new_checkout(self):
        from django.utils import timezone
        from datetime import timedelta
        first = self.checkout()
        self.assertEqual(first.status_code, 201)
        Order.objects.filter(pk=first.data["id"]).update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.checkout().status_code, 201)

    def test_old_duplicate_orders_cannot_both_be_fulfilled(self):
        first, second = self.legacy_order(), self.legacy_order()
        p1, p2 = self.payment(first), self.payment(second)
        self.success(p1)
        self.success(p2)
        self.success(p2)
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual(first.status, Order.STATUS_PAID)
        self.assertEqual(second.status, Order.STATUS_PENDING)
        attempt = p2.attempts.get()
        self.assertEqual(attempt.status, Payment.STATUS_SUCCEEDED)
        self.assertEqual(attempt.review_reason, "already_owned")
        self.assertTrue(attempt.review_required)
        self.assertEqual(LibraryEntry.objects.filter(user=self.buyer, game=self.game).count(), 1)

    def test_cannot_start_payment_if_recipient_now_owns_game(self):
        order = self.legacy_order(recipient=self.recipient)
        LibraryEntry.objects.create(user=self.recipient, game=self.game)
        response = self.client.post("/api/v1/payments/create/", {"order_id": str(order.pk)})
        self.assertEqual(response.status_code, 409)
        self.assertFalse(Payment.objects.filter(order=order).exists())

    def test_mixed_old_order_goes_to_review_without_partial_grant(self):
        game2 = Game.objects.create(title="Another", slug="another-owned-test", price=Decimal("7.00"), is_published=True)
        order = self.legacy_order(games=[self.game, game2])
        payment = self.payment(order)
        LibraryEntry.objects.create(user=self.buyer, game=self.game)
        self.success(payment)
        self.assertTrue(payment.attempts.get().review_required)
        self.assertFalse(LibraryEntry.objects.filter(user=self.buyer, game=game2).exists())
        order.refresh_from_db()
        self.assertEqual(order.total, Decimal("17.00"))
        self.assertEqual(order.items.count(), 2)

    def test_refunded_purchase_can_be_bought_again(self):
        order = self.legacy_order()
        self.success(self.payment(order))
        self.assertEqual(self.client.post(f"/api/v1/store/orders/{order.pk}/refund/").status_code, 200)
        response = self.checkout()
        self.assertEqual(response.status_code, 201, response.data)
        self.success(self.payment(Order.objects.get(pk=response.data["id"])))
        self.assertEqual(LibraryEntry.objects.filter(user=self.buyer, game=self.game).count(), 1)

    def test_recipient_deletion_cannot_redirect_existing_gift(self):
        from django.db.models.deletion import ProtectedError
        order = self.legacy_order(recipient=self.recipient)
        payment = self.payment(order)
        with self.assertRaises(ProtectedError):
            self.recipient.delete()
        self.success(payment)
        self.assertTrue(LibraryEntry.objects.filter(user=self.recipient, game=self.game).exists())
        self.assertFalse(LibraryEntry.objects.filter(user=self.buyer, game=self.game).exists())
