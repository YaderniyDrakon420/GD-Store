import json
from pathlib import Path

from django.conf import settings
from django.core.files import File
from django.core.management.base import BaseCommand
from django.db import transaction
from apps.catalog.models import Game, Genre, Tag, Developer, Screenshot, SystemRequirement
from apps.store.models import PromoCode
from apps.studio.models import GamePresentation


class Command(BaseCommand):
    help = "Install GTA V, GTA VI preorder, CS2 and Dota 2; retire the six legacy demo games. Preserve admin edits."

    @transaction.atomic
    def handle(self, *args, **options):
        rows = json.loads((Path(__file__).parents[2] / "catalog_seed.json").read_text(encoding="utf-8"))
        details = json.loads((Path(__file__).parents[2] / "catalog_details.json").read_text(encoding="utf-8"))
        retired = Game.objects.filter(slug__in=[
            "orbital", "ashen", "velocity", "echoes", "hollow", "nightshift",
        ], is_published=True).update(is_published=False)
        added = 0
        for row in rows:
            game, created = Game.objects.get_or_create(slug=row["id"], defaults={
                "title": row["title"], "short_description": row["tagline"],
                "description": row["description"], "price": row["price"],
                "discount_percent": row["discount"], "is_published": True,
                "is_preorder": row["isPreorder"], "release_date": row["releaseDate"],
                "platforms": row["platforms"], "official_url": row["officialUrl"],
            })
            GamePresentation.objects.get_or_create(game=game, defaults={"data": {
                key: row[key] for key in ["image", "color", "position"]
            }})
            detail = details.get(game.slug, {})
            if detail.get("requirements"):
                SystemRequirement.objects.get_or_create(game=game, defaults=detail["requirements"])
            if not game.screenshots.exists():
                for index, image_path in enumerate(detail.get("screenshots", [])):
                    image = settings.BASE_DIR.parent / "frontend/public" / image_path.lstrip("/")
                    if image.is_file():
                        screenshot = Screenshot(game=game, order=index)
                        with image.open("rb") as handle:
                            screenshot.image.save(image.name, File(handle))
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
        self.stdout.write(self.style.SUCCESS(f"Created {added} games; retired {retired} legacy games. Existing game edits and order history preserved."))
