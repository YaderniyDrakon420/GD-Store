from rest_framework import serializers

from apps.accounts.serializers import UserPublicSerializer

from .models import Review


class ReviewSerializer(serializers.ModelSerializer):
    user = UserPublicSerializer(read_only=True)

    class Meta:
        model = Review
        fields = [
            "id",
            "game",
            "user",
            "is_recommended",
            "text",
            "playtime_at_review",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "user",
            "playtime_at_review",
            "created_at",
        ]

    def validate(self, attrs):
        if (
            self.instance is not None
            and "game" in attrs
            and attrs["game"] != self.instance.game
        ):
            raise serializers.ValidationError(
                {
                    "game": (
                        "Нельзя изменить игру "
                        "у существующего отзыва."
                    )
                }
            )

        game = attrs.get("game") or (self.instance.game if self.instance else None)
        if game and game.is_preorder:
            raise serializers.ValidationError({"game": "Отзывы станут доступны после релиза игры."})
        if self.instance and game:
            from apps.library.models import LibraryEntry
            if not LibraryEntry.objects.filter(user=self.context["request"].user, game=game).exists():
                raise serializers.ValidationError({"game": "Для изменения отзыва нужна игра в библиотеке."})
        return attrs