import django_filters

from .models import Game


class GameFilter(django_filters.FilterSet):
    min_price = django_filters.NumberFilter(
        field_name="price",
        lookup_expr="gte",
    )

    max_price = django_filters.NumberFilter(
        field_name="price",
        lookup_expr="lte",
    )

    genres = django_filters.CharFilter(
        field_name="genres__slug",
        lookup_expr="exact",
        distinct=True,
    )

    tags = django_filters.CharFilter(
        field_name="tags__name",
        lookup_expr="iexact",
        distinct=True,
    )

    on_sale = django_filters.BooleanFilter(
        method="filter_on_sale",
    )

    class Meta:
        model = Game
        fields = [
            "min_price",
            "max_price",
            "genres",
            "tags",
            "on_sale",
        ]

    def filter_on_sale(self, queryset, _name, value):
        if value is True:
            return queryset.filter(discount_percent__gt=0)

        if value is False:
            return queryset.filter(discount_percent=0)

        return queryset