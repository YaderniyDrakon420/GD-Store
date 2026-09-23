from rest_framework.throttling import UserRateThrottle


class CheckoutThrottle(UserRateThrottle):
    """Ограничивает частоту оформления заказов одним пользователем (защита от спама заказами)."""
    scope = "checkout"


class OrderActionThrottle(UserRateThrottle):
    """Ограничивает частоту cancel/refund одним пользователем."""
    scope = "order_action"
