from django.contrib import admin

from .models import CartItem, Order, OrderItem, PromoCode, Wishlist


class OrderItemInline(admin.TabularInline):
    model = OrderItem
    extra = 0
    readonly_fields = ["game", "price_at_purchase"]
    can_delete = False


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = ["id", "user", "recipient", "status", "subtotal", "discount_total", "total", "created_at"]
    list_filter = ["status", "created_at"]
    search_fields = ["id", "user__username", "user__email", "recipient__username"]
    date_hierarchy = "created_at"
    inlines = [OrderItemInline]
    readonly_fields = [field.name for field in Order._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(PromoCode)
class PromoCodeAdmin(admin.ModelAdmin):
    readonly_fields = ["times_used"]
    list_display = ["code", "discount_percent", "times_used", "max_uses", "is_active", "valid_from", "valid_until"]
    list_filter = ["is_active"]
    search_fields = ["code"]


@admin.register(CartItem)
class CartItemAdmin(admin.ModelAdmin):
    list_display = ["user", "game", "added_at"]
    search_fields = ["user__username", "game__title"]


@admin.register(Wishlist)
class WishlistAdmin(admin.ModelAdmin):
    list_display = ["user", "game", "added_at"]
    search_fields = ["user__username", "game__title"]
