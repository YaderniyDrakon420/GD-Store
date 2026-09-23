from .settings import *  # noqa: F403

# Local test execution never depends on a developer's SQL Server or payment env.
DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}}
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
PAYMENT_TEST_MODE = True
REST_FRAMEWORK = {**REST_FRAMEWORK, "DEFAULT_THROTTLE_CLASSES": []}  # noqa: F405

ALLOWED_HOSTS = ["testserver", "localhost", "127.0.0.1"]
SECRET_KEY = "isolated-test-key-with-at-least-32-characters"
