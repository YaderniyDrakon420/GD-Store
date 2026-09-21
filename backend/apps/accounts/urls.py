from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView

from . import views


router = DefaultRouter()

router.register(
    "friends",
    views.FriendshipViewSet,
    basename="friends",
)

router.register(
    "friendships",
    views.FriendshipViewSet,
    basename="friendships",
)


urlpatterns = [
    path("users/", views.UserSearchView.as_view()),
    path("register/", views.RegisterView.as_view()),
    path("login/", views.LoginView.as_view()),
    path("login/refresh/", TokenRefreshView.as_view()),
    path("me/", views.MeView.as_view()),
    path("users/<uuid:pk>/", views.UserPublicProfileView.as_view()),
    path("", include(router.urls)),
]