from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.db.models import Q

from rest_framework import generics, permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework_simplejwt.views import TokenObtainPairView

from .models import Friendship
from .permissions import IsFriendshipParticipant, IsRecipient
from .serializers import (
    FriendRequestCreateSerializer,
    FriendshipSerializer,
    RegisterSerializer,
    UserMeSerializer,
    UserPublicSerializer,
)


User = get_user_model()


class RegisterView(generics.CreateAPIView):
    queryset = User.objects.all()
    serializer_class = RegisterSerializer
    permission_classes = [permissions.AllowAny]


class LoginView(TokenObtainPairView):
    pass


class MeView(generics.RetrieveUpdateAPIView):
    serializer_class = UserMeSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_object(self):
        return self.request.user


class UserPublicProfileView(generics.RetrieveAPIView):
    queryset = User.objects.all()
    serializer_class = UserPublicSerializer
    permission_classes = [permissions.AllowAny]


class FriendshipViewSet(viewsets.ModelViewSet):
    permission_classes = [
        permissions.IsAuthenticated,
        IsFriendshipParticipant,
    ]

    def get_queryset(self):
        user = self.request.user

        queryset = (
            Friendship.objects
            .filter(Q(from_user=user) | Q(to_user=user))
            .select_related("from_user", "to_user")
            .order_by("-created_at")
        )

        status_value = self.request.query_params.get("status")

        if status_value:
            valid_statuses = {
                value
                for value, _label in Friendship.STATUS_CHOICES
            }

            if status_value not in valid_statuses:
                raise ValidationError(
                    {
                        "status": (
                            "Допустимые значения: "
                            "pending, accepted, blocked."
                        )
                    }
                )

            queryset = queryset.filter(status=status_value)

        return queryset

    def get_serializer_class(self):
        if self.action == "create":
            return FriendRequestCreateSerializer

        return FriendshipSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        to_user = serializer.validated_data["to_user"]

        with transaction.atomic():
            # Блокируем обоих пользователей всегда в одном порядке.
            # Это не даёт двум встречным заявкам создаться одновременно.
            list(
                User.objects
                .select_for_update()
                .filter(
                    pk__in=[
                        request.user.pk,
                        to_user.pk,
                    ]
                )
                .order_by("pk")
                .values_list("pk", flat=True)
            )

            relations = list(
                Friendship.objects
                .select_for_update()
                .filter(
                    Q(
                        from_user=request.user,
                        to_user=to_user,
                    )
                    | Q(
                        from_user=to_user,
                        to_user=request.user,
                    )
                )
            )

            blocked = next(
                (
                    relation
                    for relation in relations
                    if relation.status == "blocked"
                ),
                None,
            )

            if blocked is not None:
                raise ValidationError(
                    "Невозможно отправить заявку: "
                    "между пользователями есть блокировка."
                )

            accepted = next(
                (
                    relation
                    for relation in relations
                    if relation.status == "accepted"
                ),
                None,
            )

            if accepted is not None:
                raise ValidationError(
                    "Этот пользователь уже у вас в друзьях."
                )

            direct_pending = next(
                (
                    relation
                    for relation in relations
                    if (
                        relation.from_user_id
                        == request.user.pk
                        and relation.status == "pending"
                    )
                ),
                None,
            )

            if direct_pending is not None:
                raise ValidationError(
                    "Заявка этому пользователю уже существует."
                )

            reverse_pending = next(
                (
                    relation
                    for relation in relations
                    if (
                        relation.from_user_id
                        == to_user.pk
                        and relation.status == "pending"
                    )
                ),
                None,
            )

            if reverse_pending is not None:
                reverse_pending.status = "accepted"
                reverse_pending.save(
                    update_fields=["status"]
                )

                return Response(
                    FriendshipSerializer(
                        reverse_pending
                    ).data,
                    status=status.HTTP_200_OK,
                )

            try:
                friendship = serializer.save(
                    from_user=request.user
                )
            except IntegrityError as exc:
                raise ValidationError(
                    "Заявка в друзья уже существует."
                ) from exc

        return Response(
            FriendshipSerializer(friendship).data,
            status=status.HTTP_201_CREATED,
        )

    @action(
        detail=True,
        methods=["post"],
        permission_classes=[
            permissions.IsAuthenticated,
            IsRecipient,
        ],
    )
    def accept(self, _request, pk=None):
        del pk

        friendship_id = self.get_object().pk

        with transaction.atomic():
            friendship = (
                Friendship.objects
                .select_for_update()
                .get(pk=friendship_id)
            )

            if friendship.status != "pending":
                raise ValidationError(
                    "Можно принять только ожидающую заявку."
                )

            friendship.status = "accepted"
            friendship.save(
                update_fields=["status"]
            )

        return Response(
            FriendshipSerializer(friendship).data,
            status=status.HTTP_200_OK,
        )

    @action(
        detail=True,
        methods=["post"],
        permission_classes=[
            permissions.IsAuthenticated,
            IsRecipient,
        ],
    )
    def decline(self, _request, pk=None):
        del pk

        friendship_id = self.get_object().pk

        with transaction.atomic():
            friendship = (
                Friendship.objects
                .select_for_update()
                .get(pk=friendship_id)
            )

            if friendship.status != "pending":
                raise ValidationError(
                    "Можно отклонить только ожидающую заявку."
                )

            friendship.delete()

        return Response(
            status=status.HTTP_204_NO_CONTENT
        )

    @action(
        detail=True,
        methods=["post"],
    )
    def block(self, request, pk=None):
        reference = self.get_object()
        with transaction.atomic():
            self.lock_participants(reference)
            friendship = Friendship.objects.select_for_update().get(pk=reference.pk)
            if friendship.status == "blocked" and friendship.blocked_by_id != request.user.pk:
                raise ValidationError("Нельзя изменить чужую блокировку.")
            friendship.status = "blocked"
            friendship.blocked_by = request.user
            friendship.save(update_fields=["status", "blocked_by"])
        return Response(FriendshipSerializer(friendship).data)

    def lock_participants(self, reference):
        list(User.objects.select_for_update().filter(pk__in=[reference.from_user_id, reference.to_user_id]).order_by("pk"))

    def perform_destroy(self, instance):
        with transaction.atomic():
            self.lock_participants(instance)
            friendship = Friendship.objects.select_for_update().get(pk=instance.pk)
            if friendship.status == "blocked" and friendship.blocked_by_id != self.request.user.pk:
                raise ValidationError("Только автор блокировки может её снять. Для старой блокировки обратитесь к администратору.")
            friendship.delete()


class UserSearchView(generics.ListAPIView):
    serializer_class = UserPublicSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        query = self.request.query_params.get("search", "").strip()
        if len(query) < 2:
            return User.objects.none()
        return User.objects.filter(is_active=True).exclude(pk=self.request.user.pk).filter(
            Q(username__icontains=query) | Q(display_name__icontains=query)).order_by("username", "pk")
