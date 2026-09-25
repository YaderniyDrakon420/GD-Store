from django.apps import AppConfig


class StudioConfig(AppConfig):
    name = "apps.studio"
    verbose_name = "GD Store — сообщество"

    def ready(self):
        from . import chat_bridge  # noqa: F401
        from . import releases  # noqa: F401
        from . import presence  # noqa: F401
        from . import security  # noqa: F401
