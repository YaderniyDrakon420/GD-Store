import json
from pathlib import Path

from django.conf import settings
from django.core.files import File
from django.core.management.base import BaseCommand
from django.db import transaction
from apps.catalog.models import Game, Genre, Tag, Developer
from apps.store.models import PromoCode
from apps.studio.models import GamePresentation


class Command(BaseCommand):
    help = "Create the six fictional catalog games without overwriting existing data. No user/password seeds."

    @transaction.atomic
    def handle(self, *args, **options):
        rows = json.loads((Path(__file__).parents[2] / "catalog_seed.json").read_text(encoding="utf-8"))
        added = 0
        for row in rows:
            game, created = Game.objects.get_or_create(slug=row["id"], defaults={
                "title": row["title"], "short_description": row["tagline"],
                "description": row["description"], "price": row["price"],
                "discount_percent": row["discount"], "is_published": True,
            })
            GamePresentation.objects.get_or_create(game=game, defaults={"data": {
                key: row[key] for key in ["image", "color", "rating", "totalAchievements"]
            }})
            if not created:
                continue
            added += 1
            genre, _ = Genre.objects.get_or_create(name=row["genre"], defaults={"slug": row["id"] + "-genre"})
            game.genres.add(genre)
            for value in row["tags"]:
                game.tags.add(Tag.objects.get_or_create(name=value)[0])
            game.developers.add(Developer.objects.get_or_create(name=row["developer"])[0])
            image = settings.BASE_DIR.parent / "frontend" / "public" / row["image"].lstrip("/")
            if image.is_file():
                with image.open("rb") as handle:
                    game.cover_image.save(image.name, File(handle))
        PromoCode.objects.get_or_create(code="PLAY10", defaults={"discount_percent": 10, "is_active": True})
        self.stdout.write(self.style.SUCCESS(f"Created {added} games. Existing games were preserved."))
