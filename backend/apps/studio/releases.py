"""Notify current preorder owners when an admin publishes the released game."""
from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver

from apps.catalog.models import Game
from apps.library.models import LibraryEntry
from apps.store.models import OrderItem, Order
from .models import GameReleaseNotice, Profile, Record


@receiver(post_save, sender=Game, dispatch_uid="studio_preorder_release")
def notify_preorder_release(sender, instance, created, using, raw=False, **kwargs):
    if raw or created or instance.is_preorder or not instance.is_published:
        return
    # Read the saved row, since save(update_fields=...) may omit fields changed
    # only in the in-memory model instance.
    game = Game.objects.using(using).get(pk=instance.pk)
    if game.is_preorder or not game.is_published:
        return
    preorder_owners = {
        recipient or buyer for buyer, recipient in OrderItem.objects.using(using).filter(
            game=game, is_preorder=True, order__status=Order.STATUS_PAID,
        ).values_list("order__user_id", "order__recipient_id")
    }
    owners = LibraryEntry.objects.using(using).filter(
        game=game, user_id__in=preorder_owners, user__is_active=True,
    ).values_list("user_id", flat=True)
    with transaction.atomic(using=using):
        for user_id in owners:
            _, first_delivery = GameReleaseNotice.objects.using(using).get_or_create(user_id=user_id, game=game)
            if not first_delivery:
                continue
            profile, _ = Profile.objects.using(using).get_or_create(user_id=user_id)
            if profile.preferences.get("notifications", {}).get("releases") is False:
                continue
            Record.objects.using(using).create(kind="notifications", owner_id=user_id, data={
                "to": str(user_id), "from": None, "system": True, "category": "releases",
                "title": f"{game.title}: предзаказ завершён",
                "text": "Игра переведена в обычную продажу. В вашей учебной библиотеке обновлён её статус.",
                "url": "/game/" + game.slug, "read": False,
            })
