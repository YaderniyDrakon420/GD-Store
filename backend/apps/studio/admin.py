from django.contrib import admin
from .models import GamePresentation, Profile, Record, WalletEntry, PointsEntry

admin.site.register(GamePresentation)
admin.site.register(Profile)


@admin.register(Record)
class RecordAdmin(admin.ModelAdmin):
    list_display = ("id", "kind", "owner", "created_at")
    list_filter = ("kind",)
    readonly_fields = ("id", "kind", "owner", "data", "created_at", "updated_at")

    def has_add_permission(self, request):
        return False


class LedgerAdmin(admin.ModelAdmin):
    list_display = ("user", "amount", "text", "created_at")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


admin.site.register(WalletEntry, LedgerAdmin)
admin.site.register(PointsEntry, LedgerAdmin)

from .models import StoreProduct, AchievementAward, InventoryItem, TradeOffer, MarketListing


@admin.register(StoreProduct)
class StoreProductAdmin(admin.ModelAdmin):
    list_display = ("title", "kind", "price", "discount_percent", "is_published")
    list_filter = ("kind", "is_published")
    filter_horizontal = ("games",)

    def has_change_permission(self, request, obj=None):
        # Sold compositions are managed through the storefront's validated API.
        from .models import ProductLicense
        return super().has_change_permission(request, obj) and not (obj and ProductLicense.objects.filter(product=obj).exists())


class ReadOnlyFeatureAdmin(admin.ModelAdmin):
    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


for model in [AchievementAward, InventoryItem, TradeOffer, MarketListing]:
    admin.site.register(model, ReadOnlyFeatureAdmin)
