from rest_framework import serializers
from apps.catalog.serializers import GameListSerializer
from .models import LibraryEntry


class LibraryEntrySerializer(serializers.ModelSerializer):
    game = GameListSerializer(read_only=True)

    class Meta:
        model = LibraryEntry
        fields = ["id", "game", "purchased_at", "playtime_minutes"]
