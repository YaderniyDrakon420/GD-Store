from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/chat/", include("apps.chat.urls")),

    # --- Dev 1: аккаунты, авторизация, JWT ---
    path("api/v1/auth/", include("apps.accounts.urls")),

    # --- Dev 2: каталог игр, жанры, поиск ---
    path("api/v1/catalog/", include("apps.catalog.urls")),

    # --- Dev 3: корзина, заказы, платежи, библиотека, отзывы ---
    path("api/v1/store/", include("apps.store.urls")),
    path("api/v1/library/", include("apps.library.urls")),
    path("api/v1/reviews/", include("apps.reviews.urls")),
    path("api/v1/payments/", include("apps.payments.urls")),

    # OpenAPI / Swagger
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema")),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
