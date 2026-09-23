# Keep the old command entry point while using a single catalog initializer.
from apps.studio.management.commands.seed_catalog import Command  # noqa: F401
