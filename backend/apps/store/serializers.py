from rest_framework import serializers
from django.db.models import Q
from apps.catalog.serializers import GameListSerializer
from apps.library.models import LibraryEntry
from apps.accounts.models import Friendship
from .models import CartItem, Order, OrderItem, PromoCode, Wishlist
from .services import expire_pending_orders


class CartItemSerializer(serializers.ModelSerializer):
    """Только для чтения — отдаёт полную карточку игры."""
    game = GameListSerializer(read_only=True)

    class Meta:
        model = CartItem
        fields = ["id", "game", "added_at"]


class CartItemCreateSerializer(serializers.ModelSerializer):
    """Для POST /cart/ — принимает только id игры, сам owner проставляется во view."""

    class Meta:
        model = CartItem
        fields = ["id", "game"]

    def validate_game(self, game):
        if not game.is_published:
            raise serializers.ValidationError("Игра недоступна для покупки.")
        user = self.context["request"].user
        if LibraryEntry.objects.filter(user=user, game=game).exists():
            raise serializers.ValidationError("Игра уже в вашей библиотеке.")
        return game

    def create(self, validated_data):
        user = self.context["request"].user
        cart_item, _ = CartItem.objects.get_or_create(user=user, game=validated_data["game"])
        return cart_item

    def to_representation(self, instance):
        return CartItemSerializer(instance, context=self.context).data


class WishlistSerializer(serializers.ModelSerializer):
    game = GameListSerializer(read_only=True)

    class Meta:
        model = Wishlist
        fields = ["id", "game", "added_at"]


class WishlistCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Wishlist
        fields = ["id", "game"]

    def create(self, validated_data):
        user = self.context["request"].user
        item, _ = Wishlist.objects.get_or_create(user=user, game=validated_data["game"])
        return item

    def to_representation(self, instance):
        return WishlistSerializer(instance, context=self.context).data


class CheckoutSerializer(serializers.Serializer):
    """Вход для POST /cart/checkout/."""
    checkout_token = serializers.CharField(required=False, max_length=2048)
    promo_code = serializers.CharField(required=False, allow_blank=True, max_length=32)
    # Подарок другу: username получателя. Если не указан — покупка себе.
    recipient_username = serializers.CharField(required=False, allow_blank=True, max_length=150)

    def validate_promo_code(self, value):
        if not value:
            return value
        try:
            promo = PromoCode.objects.get(code__iexact=value)
        except PromoCode.DoesNotExist:
            raise serializers.ValidationError("Промокод не найден.")
        # Clear due reservations before checking availability. The checkout
        # rechecks under the PromoCode lock to arbitrate the final available use.
        expire_pending_orders(promo_id=promo.pk)
        promo.refresh_from_db()
        if not promo.is_valid():
            raise serializers.ValidationError("Промокод недействителен или истёк.")
        return promo

    def validate_recipient_username(self, value):
            if not value:
                return value

            buyer = self.context["request"].user
            User = buyer.__class__

            try:
                recipient = User.objects.get(username=value)
            except User.DoesNotExist as exc:
                raise serializers.ValidationError(
                    "Пользователь-получатель не найден."
                ) from exc

            if recipient == buyer:
                raise serializers.ValidationError(
                    "Нельзя подарить игру самому себе."
                )

            are_friends = Friendship.objects.filter(
                Q(from_user=buyer, to_user=recipient)
                | Q(from_user=recipient, to_user=buyer),
                status="accepted",
            ).exists()

            if not are_friends:
                raise serializers.ValidationError(
                    "Подарить игру можно только другу."
                )

            return recipient


class OrderItemSerializer(serializers.ModelSerializer):
    game = GameListSerializer(read_only=True)

    class Meta:
        model = OrderItem
        fields = ["game", "price_at_purchase", "is_preorder"]


class OrderSerializer(serializers.ModelSerializer):
    items = OrderItemSerializer(many=True, read_only=True)
    promo_code = serializers.SlugRelatedField(slug_field="code", read_only=True)
    recipient = serializers.SlugRelatedField(slug_field="username", read_only=True)
    is_gift = serializers.ReadOnlyField()

    class Meta:
        model = Order
        fields = [
            "id", "status", "subtotal", "discount_total", "total",
            "promo_code", "recipient", "is_gift",
            "created_at", "expires_at", "items",
        ]
        read_only_fields = fields
