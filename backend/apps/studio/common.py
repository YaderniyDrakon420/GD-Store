import uuid
from datetime import datetime

from django.db.models import F, Q
from django.utils import timezone
from rest_framework.exceptions import ValidationError, PermissionDenied, NotFound

from apps.accounts.models import User, Friendship
from apps.catalog.models import Game
from .models import MutationLock, Profile, Record


def lock_mutations():
    if MutationLock.objects.filter(pk=1).update(revision=F("revision") + 1) != 1:
        raise RuntimeError("Run migrations before using the studio API.")


def text(value, limit, *, required=True):
    if not isinstance(value, str):
        raise ValidationError("Ожидается текст.")
    value = value.strip()
    if (required and not value) or len(value) > limit:
        raise ValidationError(f"Введите текст длиной от {1 if required else 0} до {limit} символов.")
    return value


def choice(value, choices):
    if value not in choices:
        raise ValidationError("Недопустимое значение.")
    return value


def identifier(value):
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        raise ValidationError("Неверный идентификатор.") from None


def get_user(value, active=True):
    u = User.objects.filter(pk=identifier(value)).first()
    if not u or (active and not u.is_active):
        raise NotFound("Профиль недоступен.")
    return u


def get_game(value):
    g = Game.objects.filter(slug=text(value, 50), is_published=True).first()
    if not g:
        raise NotFound("Игра недоступна.")
    return g


def profile(user):
    return Profile.objects.get_or_create(user=user)[0]


def pair(a, b):
    return Friendship.objects.filter(Q(from_user=a, to_user=b) | Q(from_user=b, to_user=a))


def friends(a, b):
    rels = pair(a, b)
    return rels.filter(status="accepted").exists() and not rels.filter(status="blocked").exists()


def blocked(a, b):
    return pair(a, b).filter(status="blocked").exists()


def require_staff(user):
    if not user.is_staff:
        raise PermissionDenied("Нужны права администратора.")


def record(kind, value, user=None):
    r = Record.objects.filter(kind=kind, pk=identifier(value)).first()
    if not r:
        raise NotFound("Запись недоступна.")
    if user is not None and r.owner_id != user.pk:
        raise PermissionDenied("Действие доступно только автору.")
    return r


def create(_kind, _actor, **data):
    return Record.objects.create(kind=_kind, owner=_actor, data=data)


def new_record(_kind, _actor, _action, **data):
    pk = identifier(_action["id"]) if _action.get("id") else uuid.uuid4()
    if Record.objects.filter(pk=pk).exists():
        raise ValidationError("Идентификатор уже используется. Повторите действие.")
    return Record.objects.create(pk=pk, kind=_kind, owner=_actor, data=data)


def bucket(kind, user, default=None):
    row = Record.objects.filter(kind=kind, owner=user).first()
    return row or create(kind, user, value=[] if default is None else default)


def save(row):
    row.save(update_fields=["data", "updated_at"])


def string_list(value, limit=100):
    if not isinstance(value, list) or len(value) > limit or any(not isinstance(x, str) for x in value):
        raise ValidationError("Неверный список значений.")
    return list(dict.fromkeys(value))


def document(r):
    return {**r.data, "id": str(r.pk), "at": r.created_at.isoformat()}


def future(value):
    try:
        date = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if timezone.is_naive(date):
            date = timezone.make_aware(date)
        if date <= timezone.now():
            raise ValueError
        return date.isoformat()
    except (ValueError, TypeError):
        raise ValidationError("Выберите дату и время в будущем.") from None


def notify(to, actor, title, body, url):
    to = get_user(to, active=False)
    if not to.is_active:
        return
    kind = "community"
    for prefix, category in [("/messages/", "messages"), ("/gifts", "gifts"),
                             ("/library", "gifts"), ("/game/", "sales"),
                             ("/events", "invitations"), ("/friends", "invitations"),
                             ("/teammates", "teams"), ("/support", "support"),
                             ("/admin", "admin"), ("/settings", "admin"),
                             ("/notifications", "admin")]:
        if url.startswith(prefix):
            kind = category
            break
    if profile(to).preferences.get("notifications", {}).get(kind) is False:
        return
    create("notifications", to, to=str(to.pk), **{"from": str(actor.pk)},
           title=title, text=body, url=url, read=False)


def audit(user, message):
    create("adminLog", user, actor=str(user.pk), text=message)
