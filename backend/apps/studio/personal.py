import base64
import binascii
from io import BytesIO
import re

from PIL import Image, UnidentifiedImageError
from rest_framework.exceptions import ValidationError
from apps.library.models import LibraryEntry
from .common import profile, text, choice, get_game, bucket, save, string_list, record, new_record
from .commerce import points_change
from .snapshot import COSMETICS


def personal_action(user, a):
    kind, uid = a["type"], str(user.pk)
    if kind in ("game-view", "recent-clear"):
        row = bucket("recentViews", user)
        if kind == "recent-clear":
            row.data["value"] = []
        else:
            slug = get_game(a.get("game")).slug
            row.data["value"] = [slug] + [value for value in row.data.get("value", []) if value != slug][:11]
        save(row)
    elif kind == "profile":
        p = profile(user)
        user.display_name = text(a.get("name"), 40)
        avatar = text(a.get("avatar", ""), 750000, required=False)
        existing_avatar = user.avatar.url if user.avatar else ""
        if avatar and avatar != p.appearance.get("avatar") and avatar != existing_avatar:
            try:
                header, encoded = avatar.split(",", 1)
                if header not in ["data:image/png;base64", "data:image/jpeg;base64", "data:image/webp;base64"]:
                    raise ValueError
                im = Image.open(BytesIO(base64.b64decode(encoded, validate=True)))
                if im.format not in ["PNG", "JPEG", "WEBP"] or im.width * im.height > 4000000:
                    raise ValueError
                im.verify()
            except (ValueError, binascii.Error, UnidentifiedImageError, OSError, Image.DecompressionBombError):
                raise ValidationError("Нужна картинка PNG, JPEG или WebP размером до 4 мегапикселей.") from None
        color = a.get("color", "#78a9a3")
        if not isinstance(color, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
            raise ValidationError("Неверный цвет профиля.")
        from apps.catalog.models import Game
        requested_cover = a.get("cover")
        if requested_cover:
            # An existing retired cover remains valid for its owner.
            cover = requested_cover if requested_cover == p.appearance.get("cover") else get_game(requested_cover).slug
        else:
            cover = p.appearance.get("cover") or Game.objects.filter(is_published=True).order_by("slug").values_list("slug", flat=True).first() or ""
        if avatar != p.appearance.get("avatar"):
            p.appearance["cosmeticAvatar"] = ""
        if cover != p.appearance.get("cover"):
            p.appearance["cosmeticBanner"] = ""
        p.appearance.update(bio=text(a.get("bio", ""), 300, required=False),
            country=text(a.get("country", ""), 40, required=False), avatar=avatar, cover=cover,
            color=color, status=choice(a.get("status", "online"), ["online", "offline", "playing"]))
        user.save(update_fields=["display_name"])
        p.save(update_fields=["appearance"])
    elif kind in ("settings", "privacy-save", "preferences-reset"):
        p = profile(user)
        if kind == "preferences-reset":
            p.preferences = {}
        elif kind == "settings":
            values = a.get("values", {})
            if not isinstance(values, dict) or set(values) - {"compact", "motionOff", "notifications"}:
                raise ValidationError("Неизвестная настройка.")
            for key, value in values.items():
                if key == "notifications":
                    allowed = {"messages", "teams", "gifts", "sales", "releases", "invitations", "support", "community", "admin"}
                    if not isinstance(value, dict) or set(value) - allowed or any(type(v) is not bool for v in value.values()):
                        raise ValidationError("Неверные настройки уведомлений.")
                    p.preferences.setdefault(key, {}).update(value)
                elif type(value) is not bool:
                    raise ValidationError("Ожидается логическое значение.")
                else:
                    p.preferences[key] = value
        else:
            values = a.get("values", a)
            if not isinstance(values, dict):
                raise ValidationError("Неверные настройки приватности.")
            for key in ["libraryPrivacy", "activityPrivacy", "friendsPrivacy", "requestsPrivacy"]:
                if key in values:
                    p.preferences[key] = choice(values[key], ["all", "friends", "none"])
            if "saleAlerts" in values:
                if type(values["saleAlerts"]) is not bool:
                    raise ValidationError("Неверная настройка уведомлений.")
                p.preferences["saleAlerts"] = values["saleAlerts"]
        p.save(update_fields=["preferences"])
    elif kind in ("compare", "compare-clear"):
        row = bucket("comparison", user)
        ids = row.data["value"]
        if kind == "compare-clear":
            ids = []
        else:
            slug = get_game(a.get("game")).slug
            if slug in ids:
                ids.remove(slug)
            elif len(ids) >= 3:
                raise ValidationError("Можно сравнить не больше трёх игр.")
            else:
                ids.append(slug)
        row.data["value"] = ids
        save(row)
    elif kind in ("collection-save", "collection-delete", "showcase-save"):
        if kind == "collection-delete":
            record("collections", a.get("collection"), user).delete()
            return {}
        ids = string_list(a.get("games" if kind == "showcase-save" else "gameIds", []), 3 if kind == "showcase-save" else 100)
        owned = set(LibraryEntry.objects.filter(user=user).values_list("game__slug", flat=True))
        if set(ids) - owned:
            raise ValidationError("Можно выбрать только игры из своей библиотеки.")
        if kind == "showcase-save":
            p = profile(user)
            p.appearance["showcase"] = {"title": text(a.get("title", ""), 60, required=False), "games": ids}
            p.save(update_fields=["appearance"])
        else:
            from .models import Record
            row = record("collections", a["collection"], user) if a.get("collection") else None
            name = text(a.get("name"), 45)
            if any(r.pk != (row.pk if row else None) and r.data.get("name", "").casefold() == name.casefold()
                   for r in Record.objects.filter(kind="collections", owner=user)):
                raise ValidationError("Коллекция с таким названием уже существует.")
            data = {"owner": uid, "name": name, "color": choice(a.get("color"), ["teal", "violet", "amber", "rose"]), "gameIds": ids}
            if row:
                row.data = data
                save(row)
            else:
                row = new_record("collections", user, a, **data)
            return {"id": str(row.pk)}
    elif kind in ("cosmetic-buy", "cosmetic-equip"):
        item = next((c for c in COSMETICS if c["id"] == a.get("item")), None)
        owned = bucket("cosmeticsOwned", user)
        if kind == "cosmetic-buy":
            if not item:
                raise ValidationError("Предмет не найден.")
            if item["id"] in owned.data["value"]:
                raise ValidationError("Предмет уже куплен.")
            points_change(user, -item["price"], "Покупка предмета «" + item["name"] + "»")
            owned.data["value"].append(item["id"])
            save(owned)
        else:
            slot = choice(a.get("slot"), ["avatar", "banner", "frame"])
            if a.get("item") and (not item or item["id"] not in owned.data["value"] or item["type"] != slot):
                raise ValidationError("Предмет недоступен для этого слота.")
            p = profile(user)
            p.appearance["cosmetic" + slot.title()] = item["id"] if item else ""
            if item and slot == "banner":
                p.appearance["cover"] = item["game"]
            p.save(update_fields=["appearance"])
    else:
        return None
    return {}
