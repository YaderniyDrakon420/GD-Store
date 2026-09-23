from django.conf import settings
from django.db import models
from apps.catalog.models import Game


class Review(models.Model):
    game = models.ForeignKey(Game, related_name="reviews", on_delete=models.CASCADE)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="reviews", on_delete=models.CASCADE)
    is_recommended = models.BooleanField()  # как в Steam: "рекомендую / не рекомендую"
    text = models.TextField(blank=True)
    playtime_at_review = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("game", "user")
