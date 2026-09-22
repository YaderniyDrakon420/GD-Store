from rest_framework import serializers

from .models import (
    Developer,
    Game,
    Genre,
    Publisher,
    Screenshot,
    SystemRequirement,
    Tag,
)


class GenreSerializer(serializers.ModelSerializer):
    class Meta:
        model = Genre
        fields = ["id", "name", "slug"]


class TagSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tag
        fields = ["id", "name"]


class DeveloperSerializer(serializers.ModelSerializer):
    class Meta:
        model = Developer
        fields = ["id", "name"]


class PublisherSerializer(serializers.ModelSerializer):
    class Meta:
        model = Publisher
        fields = ["id", "name"]


class ScreenshotSerializer(serializers.ModelSerializer):
    class Meta:
        model = Screenshot
        fields = ["id", "image", "order"]


class SystemRequirementSerializer(serializers.ModelSerializer):
    class Meta:
        model = SystemRequirement
        fields = [
            "os",
            "cpu",
            "ram",
            "gpu",
            "storage",
            "notes",
        ]


class GameListSerializer(serializers.ModelSerializer):
    genres = GenreSerializer(many=True, read_only=True)
    tags = TagSerializer(many=True, read_only=True)
    final_price = serializers.ReadOnlyField()

    class Meta:
        model = Game
        fields = [
            "id",
            "title",
            "slug",
            "short_description",
            "cover_image",
            "price",
            "discount_percent",
            "final_price",
            "genres",
            "tags",
            "release_date",
            "is_preorder",
            "platforms",
            "official_url",
        ]


class GameDetailSerializer(serializers.ModelSerializer):
    genres = GenreSerializer(many=True, read_only=True)
    tags = TagSerializer(many=True, read_only=True)
    developers = DeveloperSerializer(many=True, read_only=True)
    publishers = PublisherSerializer(many=True, read_only=True)
    screenshots = ScreenshotSerializer(many=True, read_only=True)
    requirements = SystemRequirementSerializer(read_only=True)
    final_price = serializers.ReadOnlyField()

    class Meta:
        model = Game
        fields = [
            "id",
            "title",
            "slug",
            "short_description",
            "description",
            "cover_image",
            "price",
            "discount_percent",
            "final_price",
            "release_date",
            "is_preorder",
            "platforms",
            "official_url",
            "genres",
            "tags",
            "developers",
            "publishers",
            "screenshots",
            "requirements",
            "is_published",
            "created_at",
            "updated_at",
        ]


class GameWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Game
        fields = [
            "id",
            "title",
            "slug",
            "short_description",
            "description",
            "cover_image",
            "price",
            "discount_percent",
            "release_date",
            "is_preorder",
            "platforms",
            "official_url",
            "genres",
            "tags",
            "developers",
            "publishers",
            "is_published",
        ]
        read_only_fields = ["id"]
