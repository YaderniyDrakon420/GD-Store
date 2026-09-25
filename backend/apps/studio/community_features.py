"""Server-owned progression, community hubs and recommendations."""
import uuid
from collections import Counter

from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.accounts.models import Friendship
from apps.catalog.models import Game
from apps.library.models import LibraryEntry
from apps.reviews.models import Review
from apps.store.models import Wishlist
from .common import (bucket, create, get_game, identifier, notify, profile, record,
                     require_staff, save, text, choice)
from .models import AchievementAward, InventoryItem, MediaAttachment, Record, TradeOffer

# Fixed milestones, no XP farming by repeatedly editing/deleting the same post.
BADGES = [
    {"code": "collector", "title": "Первая коллекция", "description": "Добавьте первую игру в библиотеку", "xp": 100, "color": "teal"},
    {"code": "critic", "title": "Есть мнение", "description": "Оставьте отзыв на свою игру", "xp": 100, "color": "amber"},
    {"code": "social", "title": "Своя команда", "description": "Подружитесь с другим игроком", "xp": 50, "color": "violet"},
    {"code": "writer", "title": "Начало разговора", "description": "Создайте обсуждение игры", "xp": 50, "color": "teal"},
    {"code": "guide", "title": "Проводник", "description": "Опубликуйте руководство в центре игры", "xp": 100, "color": "amber"},
    {"code": "photographer", "title": "Красивый момент", "description": "Поделитесь скриншотом в центре игры", "xp": 50, "color": "rose"},
    {"code": "creator", "title": "Мастер своего дела", "description": "Загрузите работу в мастерскую", "xp": 150, "color": "violet"},
    {"code": "trader", "title": "Договорились", "description": "Завершите обмен предметами с другом", "xp": 100, "color": "teal"},
]
DEFINITIONS = {b["code"]: b for b in BADGES}


def sync_achievements(user):
    if not user.is_active:
        return
    docs = list(Record.objects.filter(owner=user, kind__in=["topics", "mods", "hubPosts"]))
    visible = [r for r in docs if not r.data.get("hidden")]
    conditions = {
        "collector": LibraryEntry.objects.filter(user=user).exists(),
        "critic": Review.objects.filter(user=user).exists(),
        "social": Friendship.objects.filter(Q(from_user=user) | Q(to_user=user), status="accepted").exists(),
        "writer": any(r.kind == "topics" for r in visible),
        "guide": any(r.kind == "hubPosts" and r.data.get("category") == "guide" for r in visible),
        "photographer": any(r.kind == "hubPosts" and r.data.get("category") == "screenshot" for r in visible),
        "creator": any(r.kind == "mods" for r in visible),
        "trader": TradeOffer.objects.filter(Q(sender=user) | Q(recipient=user), status="accepted").exists(),
    }
    for badge in BADGES:
        if conditions[badge["code"]]:
            award, added = AchievementAward.objects.get_or_create(user=user, code=badge["code"], defaults={"xp": badge["xp"]})
            if added:
                InventoryItem.objects.create(owner=user, code=badge["code"], award=award)
                notify(user.pk, user, "Новый значок: " + badge["title"], f"+{badge['xp']} XP и коллекционная карточка", "/inventory")


def recommendations(user):
    owned = set(LibraryEntry.objects.filter(user=user).values_list("game_id", flat=True))
    wishes = set(Wishlist.objects.filter(user=user).values_list("game_id", flat=True))
    row = Record.objects.filter(owner=user, kind="recommendations").first()
    feedback = row.data.get("value", {}) if row else {}
    games = list(Game.objects.filter(is_published=True).prefetch_related("genres", "tags"))
    interests = [g for g in games if g.pk in owned | wishes or feedback.get(g.slug) == "like"]
    genres = Counter(v.slug for g in interests for v in g.genres.all())
    tags = Counter(v.name for g in interests for v in g.tags.all())
    result = []
    for game in games:
        if game.pk in owned or feedback.get(game.slug) in ["like", "skip"]:
            continue
        common = [g.name for g in game.genres.all() if genres[g.slug]]
        score = sum(genres[g.slug] * 3 for g in game.genres.all()) + sum(tags[t.name] for t in game.tags.all())
        result.append({"game": game.slug, "score": score + (2 if game.pk in wishes else 0),
                       "reason": "Похожие жанры: " + ", ".join(common) if common else "Новый жанр для вашей коллекции"})
    return sorted(result, key=lambda r: (-r["score"], r["game"]))[:20]


def community_features_action(user, a):
    kind, uid = a["type"], str(user.pk)
    if kind == "badge-equip":
        code = text(a.get("badge", ""), 40, required=False)
        if code and not AchievementAward.objects.filter(user=user, code=code).exists():
            raise PermissionDenied("Этот значок ещё не получен.")
        p = profile(user)
        p.appearance["featuredBadge"] = code
        p.save(update_fields=["appearance"])
    elif kind in ("recommendation", "recommendations-reset"):
        row = bucket("recommendations", user, {})
        if kind == "recommendations-reset":
            row.data["value"] = {}
        else:
            game = get_game(a.get("game"))
            value = choice(a.get("value"), ["like", "skip"])
            row.data["value"][game.slug] = value
            if value == "like":
                Wishlist.objects.get_or_create(user=user, game=game)
        save(row)
    elif kind in ("hub-save", "hub-delete", "hub-moderate", "hub-like", "hub-comment"):
        row = record("hubPosts", a["post"]) if a.get("post") else None
        if kind != "hub-save" and not row:
            raise ValidationError("Выберите публикацию.")
        if kind == "hub-moderate":
            require_staff(user)
            if type(a.get("hidden")) is not bool:
                raise ValidationError("Передайте состояние публикации.")
            row.data["hidden"] = a["hidden"]
            save(row)
            return {}
        if row and row.data.get("hidden") and kind != "hub-delete":
            raise PermissionDenied("Публикация скрыта модератором.")
        if kind in ("hub-save", "hub-delete") and row and row.owner_id != user.pk:
            raise PermissionDenied("Изменить публикацию может только автор.")
        if kind == "hub-delete":
            row.delete()
        elif kind == "hub-save":
            category = choice(a.get("category"), ["news", "guide", "screenshot"])
            if category == "news":
                require_staff(user)
            data = {"author": uid, "category": category, "game": get_game(a.get("game")).slug,
                    "title": text(a.get("title"), 120), "body": text(a.get("body", ""), 12000, required=category != "screenshot"), "attachment": None}
            if category == "screenshot":
                image = MediaAttachment.objects.filter(pk=identifier(a.get("attachment")), owner=user, mime__startswith="image/").first()
                if not image:
                    raise ValidationError("Загрузите свой скриншот PNG, JPEG или WebP.")
                data["attachment"] = str(image.pk)
            if row:
                row.data.update(data)
                save(row)
            else:
                row = create("hubPosts", user, **data, likes=[], comments=[], hidden=False)
            return {"id": str(row.pk)}
        elif kind == "hub-like":
            likes = row.data.setdefault("likes", [])
            if uid in likes:
                likes.remove(uid)
            elif len(likes) < 5000:
                likes.append(uid)
            save(row)
        else:
            comments = row.data.setdefault("comments", [])
            if len(comments) >= 500:
                raise ValidationError("В этой публикации достигнут лимит комментариев.")
            body = text(a.get("text"), 2000)
            comments.append({"id": str(uuid.uuid4()), "author": uid, "text": body, "at": timezone.now().isoformat()})
            save(row)
            if row.owner_id != user.pk:
                notify(row.owner_id, user, "Комментарий в центре игры", body[:160], "/hub/" + row.data["game"])
    else:
        return None
    return {}
