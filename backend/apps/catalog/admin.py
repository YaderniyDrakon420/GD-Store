from django.contrib import admin

from .models import (
    Developer,
    Game,
    Genre,
    Publisher,
    Screenshot,
    SystemRequirement,
    Tag,
)


class ScreenshotInline(admin.TabularInline):
    model = Screenshot
    extra = 1


class SystemRequirementInline(admin.StackedInline):
    model = SystemRequirement
    extra = 0


@admin.register(Genre)
class GenreAdmin(admin.ModelAdmin):
    list_display = ["name", "slug"]
    search_fields = ["name"]
    prepopulated_fields = {"slug": ("name",)}


@admin.register(Tag)
class TagAdmin(admin.ModelAdmin):
    list_display = ["name"]
    search_fields = ["name"]


@admin.register(Developer)
class DeveloperAdmin(admin.ModelAdmin):
    list_display = ["name"]
    search_fields = ["name"]


@admin.register(Publisher)
class PublisherAdmin(admin.ModelAdmin):
    list_display = ["name"]
    search_fields = ["name"]


@admin.register(SystemRequirement)
class SystemRequirementAdmin(admin.ModelAdmin):
    list_display = [
        "game",
        "os",
        "cpu",
        "ram",
        "gpu",
        "storage",
    ]
    search_fields = [
        "game__title",
        "os",
        "cpu",
        "gpu",
    ]
    autocomplete_fields = ["game"]


@admin.register(Game)
class GameAdmin(admin.ModelAdmin):
    list_display = [
        "title",
        "price",
        "discount_percent",
        "final_price_display",
        "is_published",
        "is_preorder",
        "release_date",
    ]

    list_filter = [
        "is_published",
        "is_preorder",
        "genres",
        "tags",
    ]

    search_fields = [
        "title",
        "description",
    ]

    prepopulated_fields = {
        "slug": ("title",)
    }

    inlines = [
        ScreenshotInline,
        SystemRequirementInline,
    ]

    @admin.display(description="Цена со скидкой")
    def final_price_display(self, obj):
        return obj.final_price