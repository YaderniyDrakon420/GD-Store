import logging

from django.core.management.base import BaseCommand

from apps.store.services import expire_pending_orders

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    """
    Помечает просроченные (expires_at в прошлом) незавершённые заказы как 'expired'.

    Заказ создаётся со сроком жизни Order.DEFAULT_TTL_MINUTES (checkout выставляет
    expires_at автоматически). Если за это время не пришёл вебхук об оплате —
    заказ считается зависшим и не должен вечно висеть в 'pending'.

    Запуск (без Celery в проекте — команда рассчитана на cron / планировщик):
        python manage.py expire_stale_orders
    """
    help = "Помечает просроченные заказы в статусе pending как expired."

    def handle(self, *args, **options):
        count = expire_pending_orders()
        logger.info("expire_stale_orders: помечено просроченными %s заказ(ов)", count)
        self.stdout.write(self.style.SUCCESS(f"Помечено просроченными: {count}"))
