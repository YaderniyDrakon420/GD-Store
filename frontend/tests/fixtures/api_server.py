"""Isolated API for the UI smoke test. Never uses the developer's MSSQL database."""
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "backend"))
os.environ["DJANGO_SETTINGS_MODULE"] = "config.test_settings"
from django.conf import settings

with tempfile.TemporaryDirectory(prefix="gd-integration-") as directory:
    settings.DATABASES["default"]["NAME"] = str(Path(directory) / "test.sqlite3")
    settings.MEDIA_ROOT = Path(directory) / "media"
    settings.PRIVATE_UPLOAD_ROOT = Path(directory) / "private_uploads"
    settings.ALLOWED_HOSTS = ["127.0.0.1", "localhost"]
    settings.DEBUG = True
    # Browsers share cookies across localhost ports; keep the disposable test
    # login separate from a developer's normal GD Store session.
    settings.SESSION_COOKIE_NAME = "gd_integration_session"
    settings.SESSION_COOKIE_SECURE = False
    settings.CSRF_COOKIE_SECURE = False
    if os.environ.get("GD_TEST_FRONTEND_ORIGIN"):
        settings.CORS_ALLOWED_ORIGINS = [os.environ["GD_TEST_FRONTEND_ORIGIN"]]
        settings.CSRF_TRUSTED_ORIGINS = settings.CORS_ALLOWED_ORIGINS
    import django
    django.setup()
    from django.core.management import call_command
    from django.contrib.auth import get_user_model
    from apps.accounts.models import Friendship
    call_command("migrate", verbosity=0)
    call_command("seed_catalog")
    User = get_user_model()
    alice = User.objects.create_user(username="alice", password="Test-strong-pass-42")
    bob = User.objects.create_user(username="bob", password="Test-strong-pass-42")
    User.objects.create_superuser(username="owner", email="owner@example.test", password="Test-strong-pass-42")
    Friendship.objects.create(from_user=alice, to_user=bob, status="accepted")
    call_command("runserver", "127.0.0.1:" + sys.argv[1], use_reloader=False)
