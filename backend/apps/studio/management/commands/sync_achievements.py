from django.core.management.base import BaseCommand
from django.db import transaction
from apps.accounts.models import User
from apps.studio.common import lock_mutations
from apps.studio.community_features import sync_achievements


class Command(BaseCommand):
    help = "Award GD Store milestones for existing activity, without duplicating rewards."

    def handle(self, *args, **options):
        for user in User.objects.filter(is_active=True):
            with transaction.atomic():
                lock_mutations()
                sync_achievements(user)
        self.stdout.write(self.style.SUCCESS("Existing achievements synchronized."))
