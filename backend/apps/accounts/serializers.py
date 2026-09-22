from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from .models import Friendship

User = get_user_model()


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8, max_length=128)
    email = serializers.EmailField(required=True)

    class Meta:
        model = User
        fields = ["id", "username", "email", "password"]

    def create(self, validated_data):
        return User.objects.create_user(**validated_data)

    def validate_username(self, value):
        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError("Этот логин уже занят.")
        return value

    def validate_email(self, value):
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("Этот email уже занят.")
        return value.lower()

    def validate(self, attrs):
        try:
            validate_password(attrs["password"], User(username=attrs["username"], email=attrs["email"]))
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"password": exc.messages}) from exc
        return attrs


class UserPublicSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "display_name",
            "avatar",
            "created_at",
        ]


class UserMeSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "email",
            "display_name",
            "avatar",
            "country_code",
            "wallet_balance",
            "is_email_verified",
        ]
        read_only_fields = [
            "username",
            "email",
            "wallet_balance",
            "is_email_verified",
        ]


class FriendshipSerializer(serializers.ModelSerializer):
    from_user = UserPublicSerializer(read_only=True)
    to_user = UserPublicSerializer(read_only=True)

    class Meta:
        model = Friendship
        fields = [
            "id",
            "from_user",
            "to_user",
            "status",
            "blocked_by",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "from_user",
            "to_user",
            "status",
            "blocked_by",
            "created_at",
        ]


class FriendRequestCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Friendship
        fields = ["id", "to_user"]
        read_only_fields = ["id"]

    def validate_to_user(self, to_user):
        request_user = self.context["request"].user
        from apps.studio.common import profile
        if not to_user.is_active or profile(to_user).preferences.get("requestsPrivacy", "all") != "all":
            raise serializers.ValidationError("Пользователь не принимает заявки в друзья.")

        if to_user == request_user:
            raise serializers.ValidationError(
                "Нельзя отправить заявку в друзья самому себе."
            )

        return to_user

    def validate(self, attrs):
            request_user = self.context["request"].user
            to_user = attrs["to_user"]

            direct = Friendship.objects.filter(
                from_user=request_user,
                to_user=to_user,
            ).first()

            if direct:
                if direct.status == "accepted":
                    raise serializers.ValidationError(
                        "Этот пользователь уже у вас в друзьях."
                    )

                if direct.status == "blocked":
                    raise serializers.ValidationError(
                        "Нельзя отправить заявку этому пользователю."
                    )

                raise serializers.ValidationError(
                    "Заявка этому пользователю уже существует."
                )

            reverse = Friendship.objects.filter(
                from_user=to_user,
                to_user=request_user,
            ).first()

            if reverse:
                if reverse.status == "accepted":
                    raise serializers.ValidationError(
                        "Этот пользователь уже у вас в друзьях."
                    )

                if reverse.status == "blocked":
                    raise serializers.ValidationError(
                        "Нельзя отправить заявку этому пользователю."
                    )

                # reverse pending специально разрешаем:
                # FriendshipViewSet автоматически примет
                # встречную заявку.
                if reverse.status == "pending":
                    return attrs

            return attrs
