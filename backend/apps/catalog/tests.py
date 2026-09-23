from decimal import Decimal
from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase
from .models import Game, Genre


class CatalogContractTests(APITestCase):
    def game(self, title, price="10.00", discount=0):
        return Game.objects.create(title=title, slug=title.lower(), price=Decimal(price), discount_percent=discount, is_published=True)

    def test_genre_filter_accepts_slug(self):
        genre = Genre.objects.create(name="Action", slug="action")
        game = self.game("ActionGame")
        game.genres.add(genre)
        self.game("OtherGame")
        response = self.client.get("/api/v1/catalog/games/", {"genres": "action"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row["slug"] for row in response.data["results"]], [game.slug])

    def test_sale_filter_runs_before_pagination(self):
        self.game("Sale", discount=50)
        for index in range(14):
            self.game(f"Normal{index}")
        response = self.client.get("/api/v1/catalog/games/", {"on_sale": "true"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["slug"], "sale")

    def test_effective_price_ordering_includes_discount(self):
        self.game("Discounted", "100.00", 99)
        self.game("Regular", "2.00")
        response = self.client.get("/api/v1/catalog/games/", {"ordering": "effective_price"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual([g["slug"] for g in response.data["results"]], ["discounted", "regular"])

    def test_fractional_effective_price_is_not_integer_division(self):
        self.game("Fraction", "1.00", 25)
        self.game("Lower", "0.50")
        response = self.client.get("/api/v1/catalog/games/", {"ordering": "effective_price"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual([g["slug"] for g in response.data["results"]], ["lower", "fraction"])

    def test_genres_support_second_page_with_stable_order(self):
        for index in range(21):
            Genre.objects.create(name=f"Genre{index:02d}", slug=f"genre-{index}")
        first = self.client.get("/api/v1/catalog/genres/").data
        second = self.client.get("/api/v1/catalog/genres/", {"page": 2}).data
        self.assertEqual(len(first["results"]), 20)
        self.assertEqual(len(second["results"]), 1)
        self.assertNotEqual(first["results"][0]["id"], second["results"][0]["id"])

    def test_anonymous_catalog_still_hides_staff_drafts(self):
        game = self.game("Draft")
        game.is_published = False
        game.save(update_fields=["is_published"])
        self.assertEqual(self.client.get("/api/v1/catalog/games/").data["count"], 0)
        staff = get_user_model().objects.create(username="catalog-staff", is_staff=True)
        self.client.force_authenticate(staff)
        self.assertEqual(self.client.get("/api/v1/catalog/games/").data["count"], 1)
