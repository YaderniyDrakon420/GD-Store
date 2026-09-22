import uuid
from django.conf import settings
from django.utils import timezone
from rest_framework.exceptions import ValidationError, PermissionDenied
from apps.accounts.models import User
from apps.store.models import Wishlist
from .models import Record
from .common import (text, choice, record, new_record, bucket, save, notify, require_staff,
                     get_user, get_game, profile, create, audit)


def notify_staff(user, title, message, url):
    for admin in User.objects.filter(is_staff=True, is_active=True).exclude(pk=user.pk):
        notify(admin.pk, user, title, message, url)


def support_action(user, a):
    kind, uid = a["type"], str(user.pk)
    if kind in ("ticket-create", "ticket-reply", "ticket-status"):
        if kind == "ticket-create":
            title = text(a.get("title"), 100)
            row = new_record("tickets", user, a, owner=uid, title=title,
                category=choice(a.get("category"), ["Покупка", "Аккаунт", "Жалоба", "Другое"]), status="open",
                messages=[{"id": str(uuid.uuid4()), "author": uid, "text": text(a.get("text"), 2000),
                           "at": timezone.now().isoformat()}])
            notify_staff(user, "Новое обращение", title, "/support")
            return {"id": str(row.pk)}
        row = record("tickets", a.get("ticket"))
        if row.owner_id != user.pk and not user.is_staff:
            raise PermissionDenied("Обращение вам не принадлежит.")
        if kind == "ticket-status":
            require_staff(user)
            row.data["status"] = choice(a.get("status"), ["open", "in-progress", "resolved"])
            notify(row.owner_id, user, "Статус обращения изменён", row.data["title"], "/support")
        else:
            if row.data["status"] == "resolved":
                raise ValidationError("Обращение закрыто. Администратор может открыть его снова.")
            row.data["messages"].append({"id": str(uuid.uuid4()), "author": uid,
                                         "text": text(a.get("text"), 2000), "at": timezone.now().isoformat()})
            if row.owner_id == user.pk:
                notify_staff(user, "Ответ в обращении", row.data["title"], "/support")
            else:
                notify(row.owner_id, user, "Ответ поддержки", row.data["title"], "/support")
        save(row)
    elif kind in ("notification-read", "notifications-read-all"):
        rows = [record("notifications", a.get("notification"), user)] if kind == "notification-read" else Record.objects.filter(kind="notifications", owner=user)
        for row in rows:
            row.data["read"] = True
            save(row)
    elif kind == "gift-open":
        row = record("gifts", a.get("gift"))
        if row.data["to"] != uid:
            raise PermissionDenied("Этот подарок вам не принадлежит.")
        row.data["opened"] = True
        save(row)
    elif kind in ("sale-check", "sale-demo"):
        if profile(user).preferences.get("saleAlerts") is False:
            return {}
        if kind == "sale-demo" and not settings.PAYMENT_TEST_MODE:
            raise PermissionDenied("Учебный режим выключен.")
        watch = bucket("saleWatch", user, {})
        current = {}
        for row in Wishlist.objects.filter(user=user, game__is_published=True).select_related("game"):
            game = row.game
            price = float(game.final_price)
            previous = watch.data["value"].get(game.slug)
            if kind == "sale-demo" and a.get("game") == game.slug:
                notify(user.pk, user, "Демо: скидка на желаемое", "Пример уведомления. Цена не изменена.", "/game/" + game.slug)
            elif kind == "sale-check" and previous is not None and price < previous:
                notify(user.pk, user, "Игра подешевела", f"{game.title}: {previous} → {price} ₴", "/game/" + game.slug)
            current[game.slug] = price
        watch.data["value"] = current
        save(watch)
    elif kind == "report-create":
        target = get_user(a.get("user"), active=False)
        if target == user:
            raise ValidationError("Выберите другого пользователя.")
        report_kind = choice(a.get("kind"), ["player", "message"])
        message_id, evidence = "", ""
        if report_kind == "message":
            message = record("messages", a.get("messageId"))
            if message.data.get("to") != uid or message.owner_id != target.pk:
                raise PermissionDenied("Нельзя пожаловаться на чужую переписку.")
            message_id, evidence = str(message.pk), message.data["text"]
        if any(r.data.get("status") == "pending" and r.data.get("user") == str(target.pk) and
               r.data.get("messageId", "") == message_id for r in Record.objects.filter(kind="reports", owner=user)):
            raise ValidationError("Жалоба уже ожидает рассмотрения.")
        row = new_record("reports", user, a, reporter=uid, user=str(target.pk), kind=report_kind,
            messageId=message_id, evidence=evidence, reason=choice(a.get("reason"),
            ["Спам", "Оскорбления", "Мошенничество", "Неприемлемый контент", "Другое"]),
            details=text(a.get("details", ""), 1000, required=False), status="pending", note="")
        notify_staff(user, "Новая жалоба", row.data["reason"], "/admin")
        return {"id": str(row.pk)}
    elif kind.startswith("admin-"):
        require_staff(user)
        if kind in ("admin-ban", "admin-unban", "admin-role"):
            target = get_user(a.get("user"), active=False)
            if target == user or target.is_superuser:
                raise PermissionDenied("Нельзя изменять собственные права или владельца сервера.")
            if kind == "admin-role":
                if not user.is_superuser:
                    raise PermissionDenied("Назначать администраторов может только владелец сервера.")
                target.is_staff = choice(a.get("role"), ["admin", "player"]) == "admin"
                target.save(update_fields=["is_staff"])
                notify(target.pk, user, "Роль изменена", "Проверьте права своего профиля.", "/settings")
            else:
                if target.is_staff:
                    raise PermissionDenied("Сначала владелец сервера должен снять права администратора.")
                target.is_active = kind == "admin-unban"
                target.save(update_fields=["is_active"])
                p = profile(target)
                p.appearance["banReason"] = "" if target.is_active else text(a.get("reason"), 240)
                p.save(update_fields=["appearance"])
            audit(user, f"{kind}: @{target.username}")
        elif kind == "admin-moderate":
            collection = choice(a.get("collection"), ["topics", "mods"])
            field = choice(a.get("field"), ["hidden", "locked"] if collection == "topics" else ["hidden"])
            row = record(collection, a.get("item"))
            row.data[field] = not row.data.get(field, False)
            save(row)
            audit(user, f"{collection}/{row.pk}: {field}={row.data[field]}")
            notify(row.owner_id, user, "Статус публикации изменён", row.data["title"], "/notifications")
        elif kind == "admin-announcement":
            if type(a.get("enabled")) is not bool:
                raise ValidationError("Неверное состояние объявления.")
            body = text(a.get("text", ""), 160, required=a["enabled"])
            Record.objects.filter(kind="announcement").delete()
            create("announcement", user, enabled=a["enabled"], text=body)
            audit(user, "Объявление обновлено")
        elif kind == "admin-report-resolve":
            row = record("reports", a.get("report"))
            if row.data["status"] != "pending":
                raise ValidationError("Жалоба уже рассмотрена.")
            row.data.update(status=choice(a.get("status"), ["resolved", "dismissed"]),
                note=text(a.get("note", ""), 500, required=False), reviewedBy=uid,
                reviewedAt=timezone.now().isoformat())
            save(row)
            notify(row.owner_id, user, "Жалоба рассмотрена", row.data["note"] or row.data["status"], "/notifications")
            audit(user, "Рассмотрена жалоба " + str(row.pk))
        else:
            raise ValidationError("Неизвестное действие администратора.")
    else:
        return None
    return {}
