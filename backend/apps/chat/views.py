from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import generics, permissions, serializers, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.pagination import CursorPagination
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework.views import APIView
from apps.accounts.models import Friendship
from apps.accounts.serializers import UserPublicSerializer
from apps.accounts.views import SerializedAccountWrites
from .models import Conversation, Message

User = get_user_model()


def participants(user):
    return Conversation.objects.filter(Q(first=user) | Q(second=user)).select_related("first", "second")


def can_send(user, peer):
    relations = Friendship.objects.filter(Q(from_user=user, to_user=peer) | Q(from_user=peer, to_user=user))
    if not peer.is_active or relations.filter(status="blocked").exists() or not relations.filter(status="accepted").exists():
        raise PermissionDenied("Сообщения доступны только друзьям без блокировки.")


class SendThrottle(UserRateThrottle):
    scope = "chat_send"


class MessageSerializer(serializers.ModelSerializer):
    class Meta:
        model = Message
        fields = ["id", "sender", "client_id", "text", "created_at"]
        read_only_fields = ["id", "sender", "created_at"]


class ConversationSerializer(serializers.ModelSerializer):
    peer = serializers.SerializerMethodField()
    unread = serializers.SerializerMethodField()
    last_message = serializers.SerializerMethodField()

    class Meta:
        model = Conversation
        fields = ["id", "peer", "unread", "last_message", "updated_at"]

    def get_peer(self, obj):
        user = self.context["request"].user
        return UserPublicSerializer(obj.second if obj.first_id == user.pk else obj.first, context=self.context).data

    def get_unread(self, obj):
        user = self.context["request"].user
        read = obj.first_read if obj.first_id == user.pk else obj.second_read
        return obj.messages.filter(id__gt=read).exclude(sender=user).count()

    def get_last_message(self, obj):
        message = obj.messages.first()
        return MessageSerializer(message).data if message else None


class ConversationList(SerializedAccountWrites, generics.ListAPIView):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = ConversationSerializer

    def get_queryset(self):
        return participants(self.request.user)

    def post(self, request):
        class Input(serializers.Serializer):
            peer = serializers.UUIDField()
        data = Input(data=request.data)
        data.is_valid(raise_exception=True)
        peer = get_object_or_404(User, pk=data.validated_data["peer"], is_active=True)
        if peer == request.user:
            raise ValidationError("Нельзя создать диалог с собой.")
        first, second = sorted([request.user.pk, peer.pk])
        with transaction.atomic():
            list(User.objects.select_for_update().filter(pk__in=[first, second]).order_by("pk"))
            can_send(request.user, peer)
            obj, created = Conversation.objects.get_or_create(first_id=first, second_id=second)
        return Response(self.get_serializer(obj).data, status=201 if created else 200)


class MessagePagination(CursorPagination):
    page_size = 50
    ordering = "-id"


class MessageList(SerializedAccountWrites, generics.ListAPIView):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = MessageSerializer
    pagination_class = MessagePagination

    def get_queryset(self):
        conversation = get_object_or_404(participants(self.request.user), pk=self.kwargs["pk"])
        messages = conversation.messages.all()
        after = self.request.query_params.get("after")
        if after is not None:
            try:
                after = int(after)
                if after < 0: raise ValueError()
            except ValueError:
                raise ValidationError("Некорректный номер сообщения.")
            messages = messages.filter(id__gt=after)
        return messages

    def get_throttles(self):
        return [SendThrottle()] if self.request.method == "POST" else []

    def post(self, request, pk):
        data = MessageSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        reference = get_object_or_404(participants(request.user), pk=pk)
        with transaction.atomic():
            list(User.objects.select_for_update().filter(pk__in=[reference.first_id, reference.second_id]).order_by("pk"))
            conversation = Conversation.objects.select_for_update().get(pk=pk)
            peer = reference.second if reference.first_id == request.user.pk else reference.first
            can_send(request.user, peer)
            message, created = Message.objects.get_or_create(
                conversation=conversation, sender=request.user,
                client_id=data.validated_data["client_id"], defaults={"text": data.validated_data["text"]})
            if message.text != data.validated_data["text"]:
                raise ValidationError("Этот идентификатор уже использован для другого сообщения.")
            if created:
                conversation.updated_at = timezone.now()
                conversation.save(update_fields=["updated_at"])
        return Response(MessageSerializer(message).data, status=201 if created else 200)


class MarkRead(SerializedAccountWrites, APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        class Input(serializers.Serializer):
            message_id = serializers.IntegerField(min_value=1)
        data = Input(data=request.data)
        data.is_valid(raise_exception=True)
        with transaction.atomic():
            obj = get_object_or_404(participants(request.user).select_for_update(), pk=pk)
            message = get_object_or_404(obj.messages, pk=data.validated_data["message_id"])
            field = "first_read" if obj.first_id == request.user.pk else "second_read"
            setattr(obj, field, max(getattr(obj, field), message.pk))
            obj.save(update_fields=[field])
        return Response(status=status.HTTP_204_NO_CONTENT)
