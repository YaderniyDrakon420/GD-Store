from django.conf import settings
from django.db import models
from apps.catalog.models import Game


class LibraryEntry(models.Model):
    """Игра, которой владеет пользователь (появляется после успешной оплаты)."""
    user = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="library", on_delete=models.CASCADE)
    game = models.ForeignKey(Game, on_delete=models.CASCADE)
    purchased_at = models.DateTimeField(auto_now_add=True)
    playtime_minutes = models.PositiveIntegerField(default=0)

    class Meta:
        unique_together = ("user", "game")
