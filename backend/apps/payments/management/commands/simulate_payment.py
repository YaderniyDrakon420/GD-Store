from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from apps.payments.models import Payment
from apps.payments.services import apply_webhook

class Command(BaseCommand):
    help = "Simulate a provider success locally. Requires DEBUG and PAYMENT_TEST_MODE."
    def add_arguments(self, parser):
        parser.add_argument("order_id")
    def handle(self, *args, **options):
        if not settings.DEBUG or not settings.PAYMENT_TEST_MODE:
            raise CommandError("Simulation requires DEBUG=True and PAYMENT_TEST_MODE=1.")
        payment = Payment.objects.filter(order_id=options["order_id"]).first()
        if not payment or not payment.provider_payment_id:
            raise CommandError("Create a payment attempt from the order page first.")
        apply_webhook(payment.provider_payment_id, "succeeded", {"source": "local_management_command"})
        self.stdout.write("Local event processed; inspect the order status (it may require review).")
