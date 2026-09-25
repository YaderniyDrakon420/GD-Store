from rest_framework.exceptions import ValidationError
from .commerce import commerce_action
from .personal import personal_action
from .social import social_action
from .groups import groups_action
from .support import support_action
from .community_features import community_features_action, sync_achievements
from .economy import economy_action
from .products import products_action


def execute(user, action):
    for handler in [commerce_action, personal_action, social_action, groups_action, support_action,
                    community_features_action, economy_action, products_action]:
        result = handler(user, action)
        if result is not None:
            sync_achievements(user)
            if action["type"] == "accept":
                from apps.accounts.models import Friendship
                relation = Friendship.objects.select_related("from_user", "to_user").get(pk=int(action["friend"]))
                sync_achievements(relation.from_user)
            elif action["type"] == "checkout" and result.get("gift"):
                from apps.store.models import Order
                sync_achievements(Order.objects.get(pk=result["id"]).beneficiary)
            return result
    raise ValidationError("Неизвестное действие.")
