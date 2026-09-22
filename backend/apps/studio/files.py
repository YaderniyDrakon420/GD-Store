import hashlib
from pathlib import Path
import uuid
import zipfile

from django.conf import settings
from django.core.files.storage import FileSystemStorage
from django.db import transaction
from django.db.models import Sum
from django.http import FileResponse
from rest_framework.exceptions import ValidationError, PermissionDenied, NotFound
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .common import identifier, record, lock_mutations
from .models import Upload
from .views import MutationThrottle


class UploadView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser]
    throttle_classes = [MutationThrottle]

    def post(self, request):
        if request.headers.get("X-Store-User") and request.headers["X-Store-User"] != str(request.user.pk):
            raise PermissionDenied("Аккаунт изменился. Обновите страницу.")
        file = request.FILES.get("file")
        if not file or not file.name.lower().endswith(".zip") or not 0 < file.size <= settings.MAX_WORKSHOP_UPLOAD_BYTES:
            raise ValidationError("Выберите ZIP-файл размером до 10 МБ.")
        name = Path(file.name.replace("\\", "/")).name
        if len(name) > 180:
            raise ValidationError("Имя файла слишком длинное.")
        try:
            with zipfile.ZipFile(file) as archive:
                # Files are never extracted/executed by the server. Limit validation
                # work as well as storage; reject encrypted and oversized archives.
                entries = archive.infolist()
                if len(entries) > 2000 or sum(e.file_size for e in entries) > 100 * 1024 * 1024:
                    raise ValueError
                if any(e.flag_bits & 1 for e in entries) or archive.testzip():
                    raise ValueError
        except (zipfile.BadZipFile, RuntimeError, ValueError, NotImplementedError, OSError):
            raise ValidationError("Повреждённый, зашифрованный или слишком большой ZIP-архив.") from None
        file.seek(0)
        digest = hashlib.sha256()
        for chunk in file.chunks():
            digest.update(chunk)
        file.seek(0)
        storage = FileSystemStorage(location=settings.PRIVATE_UPLOAD_ROOT)
        stored = None
        try:
            with transaction.atomic():
                lock_mutations()
                used = Upload.objects.filter(owner=request.user).aggregate(total=Sum("size"))["total"] or 0
                if used + file.size > 100 * 1024 * 1024:
                    raise ValidationError("Лимит хранилища: 100 МБ на пользователя. Обратитесь к администратору.")
                stored = storage.save(uuid.uuid4().hex + ".zip", file)
                upload = Upload.objects.create(owner=request.user, storage_name=stored,
                    original_name=name, size=file.size, sha256=digest.hexdigest())
        except Exception:
            if stored:
                storage.delete(stored)
            raise
        return Response({"id": str(upload.pk), "fileName": name, "size": file.size}, status=201)


class DownloadView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        mod = record("mods", pk)
        if mod.data.get("hidden") and mod.owner_id != request.user.pk and not request.user.is_staff:
            raise PermissionDenied("Работа скрыта модератором.")
        upload = Upload.objects.filter(pk=identifier(mod.data.get("upload")), owner_id=mod.owner_id).first()
        if not upload:
            raise NotFound("Файл недоступен.")
        storage = FileSystemStorage(location=settings.PRIVATE_UPLOAD_ROOT)
        if not storage.exists(upload.storage_name):
            raise NotFound("Файл недоступен в хранилище.")
        response = FileResponse(storage.open(upload.storage_name, "rb"), as_attachment=True,
                                filename=upload.original_name, content_type="application/zip")
        response["X-Content-Type-Options"] = "nosniff"
        response["Cache-Control"] = "private, no-store"
        return response
