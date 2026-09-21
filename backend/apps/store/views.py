import logging
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.db.models import Q
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.library.models import LibraryEntry

from .models import (
    CartItem,
    Order,
    OrderItem,
    PromoCode,
    Wishlist,
)
from .serializers import (
    CartItemCreateSerializer,
    CartItemSerializer,
    CheckoutSerializer,
    OrderSerializer,
    WishlistCreateSerializer,
    WishlistSerializer,
)
from .throttles import CheckoutThrottle, OrderActionThrottle
from .cart_snapshot import cart_summary, matches_confirmation
from .services import (
    close_pending_order, lock_order_participants, check_order_participants,
    pending_order_contains_games,
)


logger = logging.getLogger(__name__)

MONEY_STEP = Decimal("0.01")


class CartViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return (
            CartItem.objects
            .filter(user=self.request.user)
            .select_related("game").prefetch_related("game__genres", "game__tags")
        )

    def get_serializer_class(self):
        if self.action == "create":
            return CartItemCreateSerializer

        return CartItemSerializer

    def get_throttles(self):
        if self.action == "checkout":
            return [CheckoutThrottle()]

        return super().get_throttles()

    def create(self, request, *args, **kwargs):
        del args, kwargs

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            instance = serializer.save()
        except IntegrityError:
            return Response(
                {"detail": "Игра уже в корзине."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(
            serializer.to_representation(instance),
            status=status.HTTP_201_CREATED,
        )

    @action(detail=False, methods=["get"])
    def summary(self, request):
        items = list(self.get_queryset())
        validator = CheckoutSerializer(data={"recipient_username": request.query_params.get("recipient_username", "")}, context={"request": request})
        validator.is_valid(raise_exception=True)
        recipient = validator.validated_data.get("recipient_username")
        data, reasons = cart_summary(request.user.pk, items, recipient.pk if recipient else None)
        rows = CartItemSerializer(items, many=True, context=self.get_serializer_context()).data
        for row, item in zip(rows, items):
            row["unavailable_reason"] = reasons[item.pk]
        data["results"] = rows
        return Response(data)

    @action(detail=False, methods=["post"])
    def checkout(self, request):
        checkout_data = CheckoutSerializer(
            data=request.data,
            context={"request": request},
        )
        checkout_data.is_valid(raise_exception=True)

        promo = checkout_data.validated_data.get("promo_code") or None
        recipient = (
            checkout_data.validated_data.get("recipient_username")
            or None
        )

        beneficiary = recipient or request.user

        with transaction.atomic():
            lock_order_participants(request.user.pk, recipient.pk if recipient else None)
            items = list(
                CartItem.objects
                .select_for_update()
                .filter(user=request.user)
                .select_related("game").prefetch_related("game__genres", "game__tags")
            )

            token = checkout_data.validated_data.get("checkout_token")
            if token and not matches_confirmation(token, request.user.pk, beneficiary.pk, items):
                return Response(
                    {"detail": "Корзина изменилась или подтверждение истекло. Обновите её перед оформлением."},
                    status=status.HTTP_409_CONFLICT,
                )
            if any(not item.game.is_published for item in items):
                return Response(
                    {"detail": "В корзине есть недоступная игра. Удалите её перед оформлением."},
                    status=status.HTTP_409_CONFLICT,
                )

            owned_game_ids = set(
                LibraryEntry.objects
                .filter(user=beneficiary)
                .values_list("game_id", flat=True)
            )

            already_owned = [
                item
                for item in items
                if item.game_id in owned_game_ids
            ]

            purchasable = [
                item
                for item in items
                if item.game_id not in owned_game_ids
            ]

            if not purchasable:
                return Response(
                    {
                        "detail": (
                            "Корзина пуста или все игры уже "
                            "есть у получателя."
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if pending_order_contains_games(
                beneficiary.pk, [item.game_id for item in purchasable],
            ):
                return Response(
                    {"detail": "Для получателя уже есть неоплаченный заказ с одной из этих игр. "
                               "Оплатите или отмените его либо дождитесь истечения срока."},
                    status=status.HTTP_409_CONFLICT,
                )

            if promo is not None:
                try:
                    promo = (
                        PromoCode.objects
                        .select_for_update()
                        .get(pk=promo.pk)
                    )
                except PromoCode.DoesNotExist:
                    return Response(
                        {"detail": "Промокод больше не существует."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                if not promo.is_valid():
                    return Response(
                        {
                            "detail": (
                                "Промокод недействителен "
                                "или уже исчерпан."
                            )
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )

            if already_owned:
                CartItem.objects.filter(id__in=[item.id for item in already_owned]).delete()

            subtotal = sum(
                (
                    item.game.final_price
                    for item in purchasable
                ),
                Decimal("0.00"),
            ).quantize(MONEY_STEP)

            discount_total = Decimal("0.00")

            if promo is not None:
                discount_total = (
                    subtotal
                    * Decimal(promo.discount_percent)
                    / Decimal("100")
                ).quantize(MONEY_STEP)

                promo.times_used += 1
                promo.save(update_fields=["times_used"])

            total = (subtotal - discount_total).quantize(
                MONEY_STEP
            )

            order = Order.objects.create(
                user=request.user,
                recipient=recipient,
                promo_code=promo,
                subtotal=subtotal,
                discount_total=discount_total,
                total=total,
                status=Order.STATUS_PENDING,
            )

            OrderItem.objects.bulk_create(
                [
                    OrderItem(
                        order=order,
                        game=item.game,
                        price_at_purchase=(
                            item.game.final_price.quantize(
                                MONEY_STEP
                            )
                        ),
                    )
                    for item in purchasable
                ]
            )

            CartItem.objects.filter(
                id__in=[item.id for item in purchasable]
            ).delete()

        logger.info(
            "Order %s created by user %s "
            "(total=%s, gift=%s, promo=%s)",
            order.id,
            request.user.id,
            order.total,
            order.is_gift,
            promo.code if promo else None,
        )

        return Response(
            OrderSerializer(order, context=self.get_serializer_context()).data,
            status=status.HTTP_201_CREATED,
        )


class WishlistViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return (
            Wishlist.objects
            .filter(user=self.request.user)
            .select_related("game").prefetch_related("game__genres", "game__tags")
        )

    def get_serializer_class(self):
        if self.action == "create":
            return WishlistCreateSerializer

        return WishlistSerializer

    def create(self, request, *args, **kwargs):
        del args, kwargs

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            instance = serializer.save()
        except IntegrityError:
            return Response(
                {"detail": "Игра уже в вишлисте."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(
            serializer.to_representation(instance),
            status=status.HTTP_201_CREATED,
        )


class OrderViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = OrderSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return (
            Order.objects
            .filter(user=self.request.user)
            .select_related(
                "recipient",
                "promo_code",
            )
            .prefetch_related("items__game__genres", "items__game__tags")
        )

    def get_throttles(self):
        if self.action in ("cancel", "refund"):
            return [OrderActionThrottle()]

        return super().get_throttles()

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        del pk

        with transaction.atomic():
            order = (
                Order.objects
                .select_for_update()
                .get(
                    pk=self.get_object().pk,
                    user=request.user,
                )
            )

            if order.status != Order.STATUS_PENDING:
                return Response(
                    {
                        "detail": (
                            "Отменить можно только заказ "
                            "в статусе pending."
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            close_pending_order(order, Order.STATUS_CANCELLED)

        logger.info(
            "Order %s cancelled by user %s",
            order.id,
            request.user.id,
        )

        return Response(OrderSerializer(order, context=self.get_serializer_context()).data)

    @action(detail=True, methods=["post"])
    def refund(self, request, pk=None):
        del pk

        from apps.payments.models import Payment

        reference = self.get_object()
        with transaction.atomic():
            lock_order_participants(reference.user_id, reference.recipient_id)
            order = (
                Order.objects
                .select_for_update()
                .prefetch_related("items__game__genres", "items__game__tags")
                .get(
                    pk=reference.pk,
                    user=request.user,
                )
            )

            check_order_participants(order, reference.user_id, reference.recipient_id)

            if order.status != Order.STATUS_PAID:
                return Response(
                    {
                        "detail": (
                            "Возврат возможен только "
                            "для оплаченного заказа."
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # Lock order matches webhook/create: Order -> Payment -> attempts.
            payment = Payment.objects.select_for_update().filter(order=order).first()
            if payment and payment.attempts.filter(review_required=True).exists():
                return Response(
                    {"detail": "Есть платёж, требующий сверки. Автоматический возврат недоступен."},
                    status=status.HTTP_409_CONFLICT,
                )

            beneficiary = order.beneficiary

            for item in order.items.all():
                still_owned_elsewhere = (
                    Order.objects
                    .filter(
                        status=Order.STATUS_PAID,
                        items__game=item.game,
                    )
                    .filter(
                        Q(recipient=beneficiary)
                        | Q(
                            user=beneficiary,
                            recipient__isnull=True,
                        )
                    )
                    .exclude(pk=order.pk)
                    .exists()
                )

                if not still_owned_elsewhere:
                    LibraryEntry.objects.filter(
                        user=beneficiary,
                        game=item.game,
                    ).delete()

            order.status = Order.STATUS_REFUNDED
            order.save(update_fields=["status"])

            if payment:
                payment.status = Payment.STATUS_REFUNDED
                payment.save(update_fields=["status", "updated_at"])
                payment.attempts.filter(
                    provider_payment_id=payment.provider_payment_id,
                    status=Payment.STATUS_SUCCEEDED,
                ).update(status=Payment.STATUS_REFUNDED, updated_at=payment.updated_at)

        logger.info(
            "Order %s refunded by user %s",
            order.id,
            request.user.id,
        )

        return Response(OrderSerializer(order, context=self.get_serializer_context()).data)