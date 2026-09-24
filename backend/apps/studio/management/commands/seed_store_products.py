"""Optional, plainly labelled educational offers; existing edits are preserved."""
from decimal import Decimal
from django.core.management.base import BaseCommand
from django.db import transaction
from apps.catalog.models import Game
from apps.studio.common import lock_mutations
from apps.studio.models import StoreProduct

GUIDE = "Памятка GD Store\n\n1. Откройте центр игры: там находятся обсуждения, руководства и мастерская.\n2. Добавьте друзей и договоритесь об игровом вечере.\n3. Получайте значки за отзывы и публикации.\n\nЭто учебный цифровой материал GD Store. Он не изменяет игру, не содержит ключей и не является официальным дополнением разработчика."


class Command(BaseCommand):
    help = "Add three explicitly educational product examples without overwriting admin edits."

    @transaction.atomic
    def handle(self, *args, **options):
        lock_mutations()
        gta = Game.objects.filter(slug="gta-v", is_published=True).first()
        cs = Game.objects.filter(slug="cs2", is_published=True).first()
        if not gta or not cs:
            self.stdout.write("Run seed_catalog first; examples need GTA V and CS2.")
            return
        common = {"is_published": True, "bonus_content": GUIDE}
        examples = [
            ("gd-learning-edition", {**common, "kind": "edition", "game": gta, "title": "GTA V + памятка GD Store · учебное издание",
                "description": "Учебная запись GTA V в библиотеке и текстовая памятка GD Store. Не официальное издание Rockstar; игровой клиент и ключ не выдаются.", "price": gta.final_price + Decimal("20.00")}),
            ("gd-learning-guide", {**common, "kind": "dlc", "game": gta, "title": "Памятка GD Store · учебное дополнение",
                "description": "Пример зависимости DLC от основной игры: текстовая памятка в библиотеке. Не добавляет контент в GTA V и не является официальным DLC.", "price": Decimal("20.00")}),
            ("gd-learning-bundle", {**common, "kind": "bundle", "title": "GTA V и CS2 · учебный комплект",
                "description": "Учебные записи двух игр в библиотеке. CS2 бесплатна; скидка применяется к платной части комплекта. Реальные лицензии не выдаются.", "price": gta.final_price, "discount_percent": 10}),
        ]
        added = 0
        for slug, defaults in examples:
            product, created = StoreProduct.objects.get_or_create(slug=slug, defaults=defaults)
            if created:
                added += 1
                if product.kind == "bundle":
                    product.games.set([gta, cs])
        self.stdout.write(self.style.SUCCESS(f"Created {added} educational offers; existing edits preserved."))
