from rest_framework.routers import DefaultRouter

from .views import CartViewSet, OrderViewSet, WishlistViewSet

router = DefaultRouter()
router.register("cart", CartViewSet, basename="cart")
router.register("wishlist", WishlistViewSet, basename="wishlist")
router.register("orders", OrderViewSet, basename="order")

urlpatterns = router.urls
