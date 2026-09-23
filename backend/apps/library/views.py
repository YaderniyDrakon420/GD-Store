from rest_framework import viewsets, permissions
from .models import LibraryEntry
from .serializers import LibraryEntrySerializer


class LibraryViewSet(viewsets.ReadOnlyModelViewSet):
    """GET /api/v1/library/ — список купленных игр пользователя"""
    serializer_class = LibraryEntrySerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return LibraryEntry.objects.filter(user=self.request.user).select_related("game").prefetch_related("game__genres", "game__tags").order_by("-id")
