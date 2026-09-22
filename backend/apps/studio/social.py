import uuid
from django.utils import timezone
from rest_framework.exceptions import ValidationError, PermissionDenied
from apps.accounts.models import Friendship, User
from apps.chat.models import Conversation, Message
from apps.library.models import LibraryEntry
from apps.reviews.models import Review
from .models import Record, Upload
from .chat_bridge import message_record_id
from .common import (text, choice, get_game, get_user, friends, blocked, pair, profile,
                     record, create, new_record, bucket, save, notify)


def visible(row, user, *, writable=False):
    if row.data.get("hidden") or (writable and row.data.get("locked")):
        raise PermissionDenied("Публикация скрыта или закрыта модератором.")


def social_action(user, a):
    kind, uid = a["type"], str(user.pk)
    if kind in ("request", "block", "message"):
        other = get_user(a.get("user"))
        if user == other:
            raise ValidationError("Выберите другого пользователя.")
        list(User.objects.select_for_update().filter(pk__in=[user.pk, other.pk]).order_by("pk"))
        rels = pair(user, other)
        if kind == "request":
            mode = profile(other).preferences.get("requestsPrivacy", "all")
            if mode == "none" or (mode == "friends" and not friends(user, other)):
                raise PermissionDenied("Игрок отключил заявки в друзья.")
            if rels.exists():
                raise ValidationError("Заявка, дружба или блокировка уже существует.")
            Friendship.objects.create(from_user=user, to_user=other)
            notify(other.pk, user, "Заявка в друзья", user.display_name or user.username, "/friends")
        elif kind == "block":
            # Keep a reverse block: each participant controls only their own block.
            rels.exclude(status="blocked").delete()
            if not rels.filter(blocked_by=user).exists():
                first, second = (other, user) if rels.filter(from_user=user, to_user=other).exists() else (user, other)
                Friendship.objects.create(from_user=first, to_user=second, status="blocked", blocked_by=user)
        else:
            if not friends(user, other):
                raise PermissionDenied("Сообщения доступны только между друзьями.")
            body = text(a.get("text"), 2000)
            from .common import identifier
            first, second = sorted([user.pk, other.pk])
            conversation, _ = Conversation.objects.get_or_create(first_id=first, second_id=second)
            message, created = Message.objects.get_or_create(conversation=conversation, sender=user,
                client_id=identifier(a["id"]) if a.get("id") else uuid.uuid4(), defaults={"text": body})
            if message.text != body:
                raise ValidationError("Идентификатор уже используется для другого сообщения.")
            if created:
                conversation.updated_at = timezone.now()
                conversation.save(update_fields=["updated_at"])
            return {"id": str(message_record_id(message.pk))}
    elif kind in ("accept", "unfriend"):
        try:
            rel = Friendship.objects.get(pk=int(a.get("friend")))
        except (ValueError, TypeError, Friendship.DoesNotExist):
            raise ValidationError("Заявка не найдена.") from None
        if user.pk not in [rel.from_user_id, rel.to_user_id]:
            raise PermissionDenied("Эта заявка вам не принадлежит.")
        if kind == "accept":
            if rel.to_user_id != user.pk or rel.status != "pending" or blocked(rel.from_user, user) or not rel.from_user.is_active:
                raise PermissionDenied("Заявка недоступна.")
            rel.status = "accepted"
            rel.save(update_fields=["status"])
            notify(rel.from_user_id, user, "Заявка принята", user.display_name or user.username, "/friends")
        else:
            if rel.status == "blocked" and rel.blocked_by_id != user.pk:
                raise PermissionDenied("Снять блокировку может только её автор.")
            rel.delete()
    elif kind in ("topic", "edit-topic", "delete-topic", "reply"):
        row = None if kind == "topic" else record("topics", a.get("topic"))
        if row:
            visible(row, user, writable=True)
            if kind != "reply" and row.owner_id != user.pk:
                raise PermissionDenied("Изменить публикацию может только автор.")
        if kind == "delete-topic":
            row.delete()
        elif kind == "reply":
            body = text(a.get("text"), 2000)
            row.data.setdefault("replies", []).append({"id": str(uuid.uuid4()), "author": uid,
                                                       "text": body, "at": timezone.now().isoformat()})
            save(row)
            if row.owner_id != user.pk and row.owner.is_active:
                notify(row.owner_id, user, "Ответ в обсуждении", body[:160], "/community/" + str(row.pk))
        else:
            data = {"author": uid, "title": text(a.get("title"), 120), "body": text(a.get("body"), 5000),
                    "game": get_game(a.get("game")).slug if a.get("game") else ""}
            if row:
                row.data.update(data)
                save(row)
            else:
                row = new_record("topics", user, a, **data, replies=[], hidden=False, locked=False)
                create("activity", user, author=uid, text="Создал обсуждение «" + data["title"] + "»")
            return {"id": str(row.pk)}
    elif kind in ("mod", "edit-mod", "delete-mod", "subscribe"):
        row = None if kind == "mod" else record("mods", a.get("mod"))
        if row:
            visible(row, user)
            if kind != "subscribe" and row.owner_id != user.pk:
                raise PermissionDenied("Изменить работу может только автор.")
        if kind == "delete-mod":
            for sub in Record.objects.filter(kind="subscriptions"):
                sub.data["value"] = [x for x in sub.data["value"] if x != str(row.pk)]
                save(sub)
            row.delete()
        elif kind == "subscribe":
            sub = bucket("subscriptions", user)
            ids = sub.data["value"]
            mid = str(row.pk)
            sub.data["value"] = [x for x in ids if x != mid] if mid in ids else ids + [mid]
            save(sub)
        else:
            data = {"author": uid, "game": get_game(a.get("game")).slug,
                "title": text(a.get("title"), 100), "description": text(a.get("description"), 2000),
                "category": choice(a.get("category"), ["Визуал", "Предметы", "Карты"]),
                "version": text(a.get("version", "1.0"), 20)}
            if a.get("upload"):
                from .common import identifier
                upload = Upload.objects.filter(pk=identifier(a["upload"]), owner=user).first()
                if not upload:
                    raise ValidationError("Загрузите ZIP-файл своей работы.")
                data.update(upload=str(upload.pk), fileName=upload.original_name, fileSize=upload.size)
            elif not row:
                raise ValidationError("Загрузите ZIP-файл своей работы.")
            if row:
                row.data.update(data)
                save(row)
            else:
                row = new_record("mods", user, a, **data, hidden=False)
                create("activity", user, author=uid, text="Опубликовал работу «" + data["title"] + "»")
            return {"id": str(row.pk)}
    elif kind in ("review", "review-vote"):
        if kind == "review":
            game = get_game(a.get("game"))
            if game.is_preorder:
                raise ValidationError("Отзывы станут доступны после релиза игры.")
            entry = LibraryEntry.objects.filter(user=user, game=game).first()
            if not entry:
                raise PermissionDenied("Отзыв можно оставить только на игру из своей библиотеки.")
            if type(a.get("positive")) is not bool:
                raise ValidationError("Выберите оценку игры.")
            review, _ = Review.objects.update_or_create(user=user, game=game, defaults={
                "text": text(a.get("text"), 2000), "is_recommended": a["positive"],
                "playtime_at_review": entry.playtime_minutes})
            return {"id": str(review.pk)}
        try:
            review = Review.objects.select_related("game").get(pk=int(a.get("review")))
        except (TypeError, ValueError, Review.DoesNotExist):
            raise ValidationError("Отзыв не найден.") from None
        if review.user_id == user.pk or not review.game.is_published:
            raise PermissionDenied("Нельзя оценить этот отзыв.")
        row = next((r for r in Record.objects.filter(kind="reviewVotes") if r.data.get("review") == str(review.pk)), None)
        row = row or create("reviewVotes", review.user, review=str(review.pk), users=[])
        ids = row.data["users"]
        row.data["users"] = [x for x in ids if x != uid] if uid in ids else ids + [uid]
        save(row)
    else:
        return None
    return {}
