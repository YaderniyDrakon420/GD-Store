from rest_framework import permissions, viewsets
from rest_framework.exceptions import ValidationError

from apps.library.models import LibraryEntry

from .models import Review
from .permissions import IsReviewOwnerOrReadOnly
from .serializers import ReviewSerializer


class ReviewViewSet(viewsets.ModelViewSet):
    serializer_class = ReviewSerializer
    permission_classes = [
        permissions.IsAuthenticatedOrReadOnly,
        IsReviewOwnerOrReadOnly,
    ]
    filterset_fields = ["game"]

    def get_queryset(self):
        return Review.objects.select_related(
            "user",
            "game",
        ).order_by("-created_at")

    def perform_create(self, serializer):
        user = self.request.user
        game = serializer.validated_data["game"]

        library_entry = LibraryEntry.objects.filter(
            user=user,
            game=game,
        ).first()

        if library_entry is None:
            raise ValidationError(
                {
                    "game": (
                        "Нельзя оставить отзыв на игру, "
                        "которой нет в вашей библиотеке."
                    )
                }
            )

        if Review.objects.filter(
            user=user,
            game=game,
        ).exists():
            raise ValidationError(
                {
                    "game": (
                        "Вы уже оставили отзыв "
                        "на эту игру."
                    )
                }
            )

        serializer.save(
            user=user,
            playtime_at_review=library_entry.playtime_minutes,
        )