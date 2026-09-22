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
