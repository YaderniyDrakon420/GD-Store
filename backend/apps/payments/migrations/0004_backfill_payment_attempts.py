from django.db import migrations
from django.db.models import Count


def backfill_attempts(apps, schema_editor):
    Payment = apps.get_model("payments", "Payment")
    Attempt = apps.get_model("payments", "PaymentAttempt")
    alias = schema_editor.connection.alias
    payments = Payment.objects.using(alias).exclude(provider_payment_id="")
    if (payments.values("provider_payment_id").annotate(n=Count("pk"))
            .filter(n__gt=1).exists()):
        raise RuntimeError(
            "Cannot migrate payment attempts: duplicate provider_payment_id values. "
            "Resolve the ambiguous payment records before retrying migration."
        )
    # Materialize each batch before writes: works without parallel open cursors.
    last_pk = None
    while True:
        batch = payments.order_by("pk")
        if last_pk is not None:
            batch = batch.filter(pk__gt=last_pk)
        rows = list(batch[:500])
        if not rows:
            break
        for payment in rows:
            attempt = Attempt.objects.using(alias).create(
                payment_id=payment.pk,
                provider=payment.provider,
                provider_payment_id=payment.provider_payment_id,
                amount=payment.amount,
                status=payment.status,
                raw_payload=payment.raw_payload,
            )
            Attempt.objects.using(alias).filter(pk=attempt.pk).update(
                created_at=payment.created_at, updated_at=payment.updated_at,
            )
        last_pk = rows[-1].pk


class Migration(migrations.Migration):
    dependencies = [("payments", "0003_paymentattempt")]
    # Deliberately irreversible: dropping accumulated attempt history is unsafe.
    operations = [migrations.RunPython(backfill_attempts)]
