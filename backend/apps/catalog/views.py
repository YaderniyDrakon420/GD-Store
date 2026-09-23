from decimal import Decimal
from django.db.models import DecimalField, ExpressionWrapper, F, Value
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import viewsets
from rest_framework.filters import OrderingFilter, SearchFilter
from rest_framework.pagination import PageNumberPagination

from .filters import GameFilter
from .models import Game, Genre, Tag
from .permissions import IsAdminOrReadOnly
from .serializers import (
    GameDetailSerializer,
    GameListSerializer,
    GameWriteSerializer,
    GenreSerializer,
    TagSerializer,
)


class StandardResultsSetPagination(PageNumberPagination):
    page_size = 12
    page_size_query_param = "page_size"
    max_page_size = 100


class GameViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAdminOrReadOnly]
    pagination_class = StandardResultsSetPagination

    filter_backends = [
        DjangoFilterBackend,
        SearchFilter,
        OrderingFilter,
    ]

    filterset_class = GameFilter
    search_fields = ["title", "short_description", "description"]
    ordering_fields = ["price", "effective_price", "release_date", "created_at"]
    lookup_field = "slug"

    def get_queryset(self):
        qs = Game.objects.annotate(
            effective_price=ExpressionWrapper(
                F("price") * (Value(Decimal("100")) - F("discount_percent")) * Value(Decimal("0.01")),
                output_field=DecimalField(max_digits=14, decimal_places=6),
            ),
        ).prefetch_related("genres", "tags").order_by("-created_at", "id")
        if self.action == "retrieve":
            qs = qs.select_related("requirements").prefetch_related("developers", "publishers", "screenshots")

        user = self.request.user

        if user and user.is_authenticated and user.is_staff:
            return qs

        return qs.filter(is_published=True)

    def get_serializer_class(self):
        if self.action == "retrieve":
            return GameDetailSerializer

        if self.action in ("create", "update", "partial_update"):
            return GameWriteSerializer

        return GameListSerializer


class GenreViewSet(viewsets.ModelViewSet):
    queryset = Genre.objects.order_by("name", "id")
    serializer_class = GenreSerializer
    permission_classes = [IsAdminOrReadOnly]
    lookup_field = "slug"


class TagViewSet(viewsets.ModelViewSet):
    queryset = Tag.objects.order_by("name", "id")
    serializer_class = TagSerializer
    permission_classes = [IsAdminOrReadOnly]
    lookup_field = "id"