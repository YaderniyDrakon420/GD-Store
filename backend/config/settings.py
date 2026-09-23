import os
from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parent.parent

# Загружаем backend/.env при локальном запуске.
# В Docker значения из env_file также продолжат работать.
load_dotenv(BASE_DIR / ".env")


SECRET_KEY = os.environ.get(
    "DJANGO_SECRET_KEY",
    "dev-only-secret-change-me-before-deployment-2026",
)

DEBUG = os.environ.get(
    "DJANGO_DEBUG",
    "1",
) == "1"

ALLOWED_HOSTS = [
    host.strip()
    for host in os.environ.get(
        "DJANGO_ALLOWED_HOSTS",
        "localhost,127.0.0.1,[::1]",
    ).split(",")
    if host.strip()
]


INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",

    # 3rd party
    "rest_framework",
    "rest_framework_simplejwt",
    "corsheaders",
    "django_filters",
    "drf_spectacular",

    # local apps
    "apps.common",
    "apps.chat",
    "apps.accounts",
    "apps.catalog",
    "apps.store",
    "apps.library",
    "apps.reviews",
    "apps.payments",
    "apps.studio",
]


MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]


ROOT_URLCONF = "config.urls"


TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]


WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

AUTH_USER_MODEL = "accounts.User"


# --- DATABASE ---

# Локально на Windows у тебя используется ODBC Driver 17.
# В Docker устанавливается ODBC Driver 18.
DEFAULT_DB_DRIVER = (
    "ODBC Driver 17 for SQL Server"
    if os.name == "nt"
    else "ODBC Driver 18 for SQL Server"
)

DATABASES = {
    "default": {
        "ENGINE": "mssql",
        "NAME": os.environ.get(
            "DB_NAME",
            "gdstore",
        ),
        "USER": os.environ.get(
            "DB_USER",
            "sa",
        ),
        "PASSWORD": os.environ.get(
            "DB_PASSWORD",
            "YourStrong!Passw0rd",
        ),
        "HOST": os.environ.get(
            "DB_HOST",
            "localhost",
        ),
        "PORT": os.environ.get(
            "DB_PORT",
            "1433",
        ),
        "OPTIONS": {
            "driver": os.environ.get(
                "DB_DRIVER",
                DEFAULT_DB_DRIVER,
            ),
            "extra_params": os.environ.get(
                "DB_EXTRA_PARAMS",
                "TrustServerCertificate=yes;",
            ),
        },
    }
}


# New installations use SQLite. Existing .env files with SQL Server connection
# fields keep their database even if they predate the DB_ENGINE setting.
DB_ENGINE = os.environ.get("DB_ENGINE") or (
    "mssql" if any(os.environ.get(key) for key in ("DB_HOST", "DB_USER", "DB_NAME")) else "sqlite"
)
if DB_ENGINE == "sqlite":
    DATABASES = {"default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": os.environ.get("SQLITE_PATH", str(BASE_DIR / "db.sqlite3")),
        "OPTIONS": {"timeout": 30},
    }}

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": (
            "django.contrib.auth.password_validation."
            "UserAttributeSimilarityValidator"
        )
    },
    {
        "NAME": (
            "django.contrib.auth.password_validation."
            "MinimumLengthValidator"
        )
    },
    {
        "NAME": (
            "django.contrib.auth.password_validation."
            "CommonPasswordValidator"
        )
    },
    {
        "NAME": (
            "django.contrib.auth.password_validation."
            "NumericPasswordValidator"
        )
    },
]


LANGUAGE_CODE = "ru"
TIME_ZONE = "Europe/Kyiv"

USE_I18N = True
USE_TZ = True


STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"


# --- DRF ---

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
        "rest_framework.authentication.SessionAuthentication",
    ),

    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticatedOrReadOnly",
    ),

    "DEFAULT_FILTER_BACKENDS": (
        "django_filters.rest_framework.DjangoFilterBackend",
    ),

    "DEFAULT_PAGINATION_CLASS": (
        "rest_framework.pagination.PageNumberPagination"
    ),

    "PAGE_SIZE": 20,

    "DEFAULT_SCHEMA_CLASS": (
        "drf_spectacular.openapi.AutoSchema"
    ),

    # Нужны существующим CheckoutThrottle,
    # OrderActionThrottle и PaymentCreateThrottle.
    "DEFAULT_THROTTLE_RATES": {
        "chat_send": "30/min",
        "checkout": os.environ.get(
            "THROTTLE_CHECKOUT_RATE",
            "10/min",
        ),
        "order_action": os.environ.get(
            "THROTTLE_ORDER_ACTION_RATE",
            "20/min",
        ),
        "payment_create": os.environ.get(
            "THROTTLE_PAYMENT_CREATE_RATE",
            "10/min",
        ),
    },
}


SIMPLE_JWT = {
    "CHECK_REVOKE_TOKEN": True,
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=30),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": True,
}


CORS_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "CORS_ALLOWED_ORIGINS",
        "http://localhost:5173",
    ).split(",")
    if origin.strip()
]

# Cookies are sent only to explicitly allowed frontend origins. Never use '*'.
from corsheaders.defaults import default_headers
CORS_ALLOW_CREDENTIALS = True
CORS_ALLOW_HEADERS = (*default_headers, "idempotency-key", "x-store-user")


# Используется существующим PaymentWebhookView.
PAYMENT_WEBHOOK_SECRET = os.environ.get(
    "PAYMENT_WEBHOOK_SECRET",
    "",
)


SPECTACULAR_SETTINGS = {
    "TITLE": "GD-Store API",
    "DESCRIPTION": "Steam-like store backend",
    "VERSION": "1.0.0",
}

# Never accepts real funds. Disabled unless explicitly enabled by the operator.
PAYMENT_TEST_MODE = os.environ.get("PAYMENT_TEST_MODE", "0") == "1"
PRIVATE_UPLOAD_ROOT = Path(os.environ.get("PRIVATE_UPLOAD_ROOT", str(BASE_DIR / "private_uploads")))
MAX_WORKSHOP_UPLOAD_BYTES = 10 * 1024 * 1024
DATA_UPLOAD_MAX_MEMORY_SIZE = 2 * 1024 * 1024
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = os.environ.get("SESSION_COOKIE_SAMESITE", "Lax")
CSRF_COOKIE_SAMESITE = SESSION_COOKIE_SAMESITE
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
CSRF_TRUSTED_ORIGINS = [x.strip() for x in os.environ.get("CSRF_TRUSTED_ORIGINS", "").split(",") if x.strip()]

if SESSION_COOKIE_SAMESITE not in {"Lax", "Strict", "None"} or (SESSION_COOKIE_SAMESITE == "None" and DEBUG):
    from django.core.exceptions import ImproperlyConfigured
    raise ImproperlyConfigured("SESSION_COOKIE_SAMESITE must be Lax/Strict/None; None requires HTTPS with DJANGO_DEBUG=0.")

if not DEBUG and SECRET_KEY == "dev-only-secret-change-me-before-deployment-2026":
    from django.core.exceptions import ImproperlyConfigured
    raise ImproperlyConfigured("Set DJANGO_SECRET_KEY before disabling DEBUG.")
