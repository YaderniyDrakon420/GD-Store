from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import GameViewSet, GenreViewSet, TagViewSet

router = DefaultRouter()
router.register(r"games", GameViewSet, basename="game")
router.register(r"genres", GenreViewSet, basename="genre")
router.register(r"tags", TagViewSet, basename="tag")

urlpatterns = [
    path("", include(router.urls)),
]