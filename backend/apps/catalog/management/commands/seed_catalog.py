import json
from pathlib import Path
from django.conf import settings
from django.core.files import File
from django.core.management.base import BaseCommand
from django.db import transaction
from apps.catalog.models import Game, Genre, Tag, Developer

class Command(BaseCommand):
    help = "Import existing GD-Store showcase artwork and games; preserve existing records."
    def handle(self, *args, **options):
        data = json.loads(Path(__file__).with_name("catalog_seed.json").read_text(encoding="utf-8"))
        created_count = 0
        for row in data:
            with transaction.atomic():
                game, created = Game.objects.get_or_create(slug=row["id"], defaults={
                    "title":row["title"], "short_description":row["tagline"],
                    "description":row["description"], "price":row["price"],
                    "discount_percent":row["discount"], "is_published":True})
                if not created:
                    continue
                genre, _ = Genre.objects.get_or_create(name=row["genre"], defaults={"slug":"genre-"+row["id"]})
                game.genres.add(genre)
                for name in row["tags"]:
                    tag, _ = Tag.objects.get_or_create(name=name)
                    game.tags.add(tag)
                developer, _ = Developer.objects.get_or_create(name=row["developer"])
                game.developers.add(developer)
                image = settings.BASE_DIR.parent / "frontend" / "public" / row["image"].lstrip("/")
                if image.is_file():
                    with image.open("rb") as handle:
                        game.cover_image.save(image.name, File(handle))
                created_count += 1
        self.stdout.write(self.style.SUCCESS(f"Created {created_count} games. Existing games unchanged."))
