from rest_framework.exceptions import ValidationError
from .commerce import commerce_action
from .personal import personal_action
from .social import social_action
from .groups import groups_action
from .support import support_action


def execute(user, action):
    for handler in [commerce_action, personal_action, social_action, groups_action, support_action]:
        result = handler(user, action)
        if result is not None:
            return result
    raise ValidationError("Неизвестное действие.")
