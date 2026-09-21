from django.contrib import admin
from .models import Conversation, Message

@admin.register(Conversation)
class ConversationAdmin(admin.ModelAdmin):
    list_display = ("id", "first", "second", "updated_at")
    readonly_fields = ("first", "second", "first_read", "second_read", "updated_at")
    def has_add_permission(self, request):
        return False

@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display = ("id", "conversation", "sender", "created_at")
    readonly_fields = ("conversation", "sender", "client_id", "text", "created_at")
    def has_add_permission(self, request):
        return False
