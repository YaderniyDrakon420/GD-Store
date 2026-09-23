from rest_framework.throttling import UserRateThrottle


class PaymentCreateThrottle(UserRateThrottle):
    """Ограничивает частоту создания платёжных сессий одним пользователем."""
    scope = "payment_create"
