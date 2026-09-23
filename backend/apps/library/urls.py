from rest_framework.routers import DefaultRouter
from .views import LibraryViewSet

router = DefaultRouter()
router.register("", LibraryViewSet, basename="library")

urlpatterns = router.urls
