from datetime import timedelta

from django.db import migrations
from django.db.models import Count, F
from django.utils import timezone


def release_legacy_reservations(apps, schema_editor):
    Order = apps.get_model("store", "Order")
    PromoCode = apps.get_model("store", "PromoCode")
    alias = schema_editor.connection.alias
    # Existing closed unpaid orders consumed uses in the old implementation.
    closed = list(Order.objects.using(alias).filter(
        status__in=["cancelled", "expired", "failed"], promo_code__isnull=False,
    ).values("promo_code_id").annotate(n=Count("pk")))
    for group in closed:
        promo = PromoCode.objects.using(alias).get(pk=group["promo_code_id"])
        if promo.times_used < group["n"]:
            raise RuntimeError(
                "Promo usage counter is inconsistent with closed orders. "
                "Reconcile existing promo counters before retrying migration."
            )
    for group in closed:
        PromoCode.objects.using(alias).filter(pk=group["promo_code_id"]).update(
            times_used=F("times_used") - group["n"],
        )
    # Old schema left expiry NULL; give legacy reservations a fresh grace period.
    Order.objects.using(alias).filter(
        status="pending", promo_code__isnull=False, expires_at__isnull=True,
    ).update(expires_at=timezone.now() + timedelta(minutes=30))


class Migration(migrations.Migration):
    dependencies = [
        ("store", "0002_promocode_alter_cartitem_options_alter_order_options_and_more"),
        ("payments", "0004_backfill_payment_attempts"),
    ]
    # Counter corrections cannot be safely reversed after new reservations.
    operations = [migrations.RunPython(release_legacy_reservations)]
