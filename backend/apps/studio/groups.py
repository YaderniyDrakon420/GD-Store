from datetime import datetime
import uuid

from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError
from .common import (record, new_record, get_game, get_user, text, choice, string_list,
                     future, friends, blocked, save, notify)


def groups_action(user, a):
    kind, uid = a["type"], str(user.pk)
    if kind in ("event-create", "event-edit", "event-cancel", "event-rsvp"):
        row = None if kind == "event-create" else record("events", a.get("event"))
        if row and kind != "event-rsvp" and row.owner_id != user.pk:
            raise PermissionDenied("Изменить событие может только организатор.")
        if kind == "event-cancel":
            if not row.data.get("cancelled"):
                row.data["cancelled"] = True
                for member in row.data["invitees"]:
                    notify(member, user, "Событие отменено", row.data["title"], "/events/" + str(row.pk))
                save(row)
        elif kind == "event-rsvp":
            if uid not in row.data["invitees"] or row.data.get("cancelled"):
                raise PermissionDenied("Приглашение недоступно.")
            future(row.data["startsAt"])
            value = choice(a.get("status"), ["going", "declined", "invited"])
            if row.data["rsvp"].get(uid) != value:
                row.data["rsvp"][uid] = value
                save(row)
                notify(row.owner_id, user, "Ответ на приглашение", row.data["title"], "/events/" + str(row.pk))
        else:
            if row and row.data.get("cancelled"):
                raise ValidationError("Событие отменено.")
            invitees = string_list(a.get("invitees", []), 50)
            for member in invitees:
                other = get_user(member)
                if not friends(user, other):
                    raise ValidationError("Приглашать можно только активных друзей.")
            data = {"host": uid, "title": text(a.get("title"), 80), "game": get_game(a.get("game")).slug,
                    "startsAt": future(a.get("startsAt")), "description": text(a.get("description", ""), 1000, required=False),
                    "invitees": invitees, "cancelled": False}
            previous = row.data["invitees"] if row else []
            previous_rsvp = row.data["rsvp"] if row else {}
            data["rsvp"] = {member: previous_rsvp.get(member, "invited") for member in invitees}
            if row:
                row.data = data
                save(row)
            else:
                row = new_record("events", user, a, **data)
            for member in invitees:
                notify(member, user, "Событие обновлено" if member in previous else "Приглашение на событие",
                       data["title"], "/events/" + str(row.pk))
            for member in set(previous) - set(invitees):
                notify(member, user, "Приглашение отозвано", data["title"], "/events")
            return {"id": str(row.pk)}
    elif kind in ("party-save", "party-join", "party-leave", "party-close", "party-message"):
        row = record("parties", a["party"]) if a.get("party") else None
        if kind != "party-save" and not row:
            raise ValidationError("Команда не найдена.")
        if kind == "party-save":
            if row and (row.owner_id != user.pk or row.data.get("closed")):
                raise PermissionDenied("Редактирование команды недоступно.")
            try:
                capacity = int(a.get("capacity"))
                if str(capacity) != str(a.get("capacity")) or not 2 <= capacity <= 8:
                    raise ValueError
            except (ValueError, TypeError):
                raise ValidationError("В команде должно быть от 2 до 8 мест.") from None
            members = row.data["members"] if row else [uid]
            if len(members) > capacity:
                raise ValidationError("В команде уже больше участников.")
            data = {"host": uid, "title": text(a.get("title"), 80), "game": get_game(a.get("game")).slug,
                    "capacity": capacity, "language": choice(a.get("language"), ["Русский", "Українська", "English"]),
                    "startsAt": future(a.get("startsAt")), "description": text(a.get("description", ""), 500, required=False),
                    "members": members, "closed": False}
            if row:
                row.data.update(data)
                save(row)
            else:
                row = new_record("parties", user, a, **data, messages=[])
            return {"id": str(row.pk)}
        elif kind == "party-close":
            if row.owner_id != user.pk:
                raise PermissionDenied("Закрыть команду может только организатор.")
            row.data["closed"] = True
            save(row)
        elif kind == "party-leave":
            if row.owner_id == user.pk:
                raise ValidationError("Организатор может закрыть команду.")
            row.data["members"] = [member for member in row.data["members"] if member != uid]
            save(row)
        else:
            if row.data.get("closed") or not row.owner.is_active or datetime.fromisoformat(row.data["startsAt"]) <= timezone.now():
                raise ValidationError("Команда закрыта или время встречи уже прошло.")
            if kind == "party-join":
                if uid in row.data["members"]:
                    return {}
                if len(row.data["members"]) >= row.data["capacity"]:
                    raise ValidationError("Свободных мест нет.")
                if any(blocked(user, get_user(member, active=False)) for member in row.data["members"]):
                    raise PermissionDenied("Вступление недоступно из-за блокировки.")
                row.data["members"].append(uid)
                notify(row.owner_id, user, "Новый участник команды", user.display_name or user.username, "/teammates")
            else:
                if uid not in row.data["members"]:
                    raise PermissionDenied("Чат доступен только участникам команды.")
                body = text(a.get("text"), 2000)
                row.data.setdefault("messages", []).append({"id": str(uuid.uuid4()), "author": uid,
                                                           "text": body, "at": timezone.now().isoformat()})
                for member in row.data["members"]:
                    if member != uid:
                        notify(member, user, "Сообщение в команде", body[:160], "/teammates")
            save(row)
    else:
        return None
    return {}
