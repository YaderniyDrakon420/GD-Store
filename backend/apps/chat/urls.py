from django.urls import path
from .views import ConversationList, MessageList, MarkRead
urlpatterns = [
    path("conversations/", ConversationList.as_view()),
    path("conversations/<int:pk>/messages/", MessageList.as_view()),
    path("conversations/<int:pk>/read/", MarkRead.as_view()),
]
