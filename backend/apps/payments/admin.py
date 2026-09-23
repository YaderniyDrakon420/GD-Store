from django.contrib import admin

from .models import Payment, PaymentAttempt


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = ["id", "order", "provider", "status", "amount", "created_at"]
    list_filter = ["provider", "status"]
    search_fields = ["id", "provider_payment_id", "order__id"]
    readonly_fields = [field.name for field in Payment._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(PaymentAttempt)
class PaymentAttemptAdmin(admin.ModelAdmin):
    list_display = ["id", "payment", "status", "amount", "review_required", "review_reason", "created_at"]
    list_filter = ["review_required", "status", "provider", "review_reason"]
    search_fields = ["provider_payment_id", "payment__id", "payment__order__id"]
    readonly_fields = [field.name for field in PaymentAttempt._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
