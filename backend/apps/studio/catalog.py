from apps.catalog.models import Game
from django.db.models import Q, Count
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
        retained.update(OrderItem.objects.filter(Q(order__user=viewer) | Q(order__recipient=viewer)).values_list("game_id", flat=True))
        visible |= Q(pk__in=retained)
    for game in Game.objects.filter(visible).annotate(review_count=Count("reviews"), positive_count=Count("reviews", filter=Q(reviews__is_recommended=True))).prefetch_related("genres", "tags", "developers", "screenshots").select_related("gamepresentation", "requirements"):
        extra = game.gamepresentation.data if hasattr(game, "gamepresentation") else {}
        requirements = ({key: getattr(game.requirements, key) for key in ["os", "cpu", "ram", "gpu", "storage", "notes"]}
                        if hasattr(game, "requirements") else None)
        result.append({
            "id": game.slug, "title": game.title,
            "tagline": game.short_description, "description": game.description,
            "genre": next((g.name for g in game.genres.all()), "Инди"),
            "tags": [t.name for t in game.tags.all()],
            "price": float(game.price), "discount": game.discount_percent,
            "finalPrice": float(game.final_price),
            "available": game.is_published,
            "isPreorder": game.is_preorder,
            "releaseDate": game.release_date.isoformat() if game.release_date else None,
            "platforms": game.platforms, "officialUrl": game.official_url,
            "position": extra.get("position", 100),
            "developer": ", ".join(d.name for d in game.developers.all()),
            "screenshots": [{"id": str(s.pk), "image": s.image.url} for s in sorted(game.screenshots.all(), key=lambda s: (s.order, s.pk)) if s.image],
            "requirements": requirements,
            "image": game.cover_image.url if game.cover_image else extra.get("image", ""),
            "color": extra.get("color", "#18332e"),
            "rating": round(100 * game.positive_count / game.review_count) if game.review_count else None,
            "reviewCount": game.review_count,
            "hours": round(playtime.get(game.pk, 0) / 60, 1), "achievements": 0,
            "totalAchievements": 0,
        })
    return sorted(result, key=lambda g: (g["position"], g["title"]))
