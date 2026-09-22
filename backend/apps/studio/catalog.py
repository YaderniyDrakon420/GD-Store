from apps.catalog.models import Game
from django.db.models import Q
from apps.library.models import LibraryEntry
from apps.store.models import CartItem, Wishlist, OrderItem


def catalog(viewer=None):
    result = []
    visible = Q(is_published=True)
    playtime = {}
    if viewer is not None and viewer.is_authenticated and viewer.is_active:
        playtime = dict(LibraryEntry.objects.filter(user=viewer).values_list("game_id", "playtime_minutes"))
        retained = set(playtime)
        retained.update(CartItem.objects.filter(user=viewer).values_list("game_id", flat=True))
        retained.update(Wishlist.objects.filter(user=viewer).values_list("game_id", flat=True))
        retained.update(OrderItem.objects.filter(order__user=viewer).values_list("game_id", flat=True))
        visible |= Q(pk__in=retained)
    for game in Game.objects.filter(visible).prefetch_related("genres", "tags", "developers").select_related("gamepresentation"):
        extra = game.gamepresentation.data if hasattr(game, "gamepresentation") else {}
        result.append({
            "id": game.slug, "title": game.title,
            "tagline": game.short_description, "description": game.description,
            "genre": next((g.name for g in game.genres.all()), "Инди"),
            "tags": [t.name for t in game.tags.all()],
            "price": float(game.price), "discount": game.discount_percent,
            "finalPrice": float(game.final_price),
            "available": game.is_published,
            "developer": ", ".join(d.name for d in game.developers.all()),
            "image": game.cover_image.url if game.cover_image else extra.get("image", "/art/orbital.png"),
            "color": extra.get("color", "#18332e"),
            "rating": extra.get("rating", 0),
            "hours": round(playtime.get(game.pk, 0) / 60, 1), "achievements": 0,
            "totalAchievements": extra.get("totalAchievements", 0),
        })
    return sorted(result, key=lambda g: (g["id"] != "orbital", g["id"] != "ashen", g["id"]))
