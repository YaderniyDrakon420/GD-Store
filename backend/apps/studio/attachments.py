"""Private attachments: ownership is checked again on every download."""
from datetime import timedelta
from io import BytesIO
from pathlib import Path
import uuid

from PIL import Image, UnidentifiedImageError
from django.conf import settings
from django.core.files.base import ContentFile
from django.core.files.storage import FileSystemStorage
from django.db import transaction
from django.db.models import Sum
from django.http import FileResponse
from django.utils import timezone
from rest_framework.exceptions import ValidationError, PermissionDenied, NotFound
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .common import friends, get_user, lock_mutations
from .models import ChatActivity, MediaAttachment, Record
from .views import MutationThrottle


class AttachmentUploadView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser]
    throttle_classes = [MutationThrottle]

    def post(self, request):
        if request.headers.get("X-Store-User") and request.headers["X-Store-User"] != str(request.user.pk):
            raise PermissionDenied("Аккаунт изменился. Обновите страницу.")
        file = request.FILES.get("file")
        if not file or not 0 < file.size <= 5 * 1024 * 1024:
            raise ValidationError("Выберите файл до 5 МБ.")
        name = Path(file.name.replace("\\", "/")).name[:180]
        ext = Path(name).suffix.lower()
        formats = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".pdf": "application/pdf", ".txt": "text/plain", ".zip": "application/zip"}
        if ext not in formats:
            raise ValidationError("Поддерживаются PNG, JPEG, WebP, PDF, TXT и ZIP.")
        mime, payload = formats[ext], file.read()
        if mime.startswith("image/"):
            try:
                im = Image.open(BytesIO(payload))
                if im.format not in ["PNG", "JPEG", "WEBP"] or im.width * im.height > 12000000:
                    raise ValueError
                im.load()
                normalized = BytesIO()
                im.convert("RGB").save(normalized, "JPEG", quality=90)
                payload, ext, mime = normalized.getvalue(), ".jpg", "image/jpeg"
                name = Path(name).stem[:170] + ext
            except (UnidentifiedImageError, ValueError, OSError, Image.DecompressionBombError):
                raise ValidationError("Повреждённое изображение или размер больше 12 мегапикселей.") from None
        storage = FileSystemStorage(location=settings.PRIVATE_UPLOAD_ROOT)
        saved = None
        try:
            with transaction.atomic():
                lock_mutations()
                used = MediaAttachment.objects.filter(owner=request.user).aggregate(total=Sum("size"))["total"] or 0
                if used + len(payload) > 100 * 1024 * 1024:
                    raise ValidationError("Лимит вложений: 100 МБ на аккаунт.")
                saved = storage.save(uuid.uuid4().hex + ext, ContentFile(payload))
                item = MediaAttachment.objects.create(owner=request.user, storage_name=saved, original_name=name, mime=mime, size=len(payload))
        except Exception:
            if saved:
                storage.delete(saved)
            raise
        return Response({"id": str(item.pk), "name": name, "mime": mime, "size": len(payload)}, status=201)


def attachment_data(item):
    return {"id": str(item.pk), "name": item.original_name, "mime": item.mime, "size": item.size,
            "url": "/api/v1/studio/attachments/" + str(item.pk) + "/"}


class AttachmentView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, pk):
        item = MediaAttachment.objects.filter(pk=pk).first()
        if not item:
            raise NotFound()
        uid = str(request.user.pk) if request.user.is_authenticated else None
        allowed = uid == str(item.owner_id)
        for row in Record.objects.filter(kind__in=["hubPosts", "messages"]):
            if row.data.get("attachment") != str(pk):
                continue
            if row.kind == "hubPosts" and (not row.data.get("hidden") or (uid and request.user.is_staff)):
                from apps.catalog.models import Game
                allowed = allowed or Game.objects.filter(slug=row.data.get("game"), is_published=True).exists()
            elif row.kind == "messages" and uid in [row.data.get("from"), row.data.get("to")]:
                allowed = True
        if not allowed:
            raise NotFound()
        storage = FileSystemStorage(location=settings.PRIVATE_UPLOAD_ROOT)
        if not storage.exists(item.storage_name):
            raise NotFound()
        response = FileResponse(storage.open(item.storage_name, "rb"), content_type=item.mime,
                                as_attachment=not item.mime.startswith("image/"), filename=item.original_name)
        response["Cache-Control"] = "private, no-store"
        response["X-Content-Type-Options"] = "nosniff"
        response["Content-Security-Policy"] = "default-src 'none'; sandbox"
        return response


class ChatActivityView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [MutationThrottle]

    @transaction.atomic
    def post(self, request):
        lock_mutations()
        if request.headers.get("X-Store-User") and request.headers["X-Store-User"] != str(request.user.pk):
            raise PermissionDenied("Аккаунт изменился.")
        peer = get_user(request.data.get("user"))
        if not friends(request.user, peer):
            raise PermissionDenied("Переписка доступна только друзьям.")
        row, _ = ChatActivity.objects.get_or_create(user=request.user, peer=peer)
        if type(request.data.get("typing", False)) is not bool:
            raise ValidationError("Неверное состояние ввода.")
        row.typing_until = timezone.now() + timedelta(seconds=8) if request.data.get("typing") else None
        if request.data.get("read"):
            row.read_at = timezone.now()
        row.save()
        return Response({"ok": True})
