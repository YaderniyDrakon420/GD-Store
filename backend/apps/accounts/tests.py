from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import RefreshToken


class SessionContractTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="session-contract", password="safe-test-password")

    def test_spa_refresh_route_returns_rotated_token_pair(self):
        original = str(RefreshToken.for_user(self.user))
        response = self.client.post("/api/v1/auth/login/refresh/", {"refresh": original})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIn("access", response.data)
        self.assertIn("refresh", response.data)
        self.assertNotEqual(response.data["refresh"], original)

    def test_refresh_denies_invalid_token(self):
        response = self.client.post("/api/v1/auth/login/refresh/", {"refresh": "invalid"})
        self.assertEqual(response.status_code, 401)

    def test_me_route_used_by_session_bootstrap_returns_current_user(self):
        self.client.force_authenticate(self.user)
        response = self.client.get("/api/v1/auth/me/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(str(response.data["id"]), str(self.user.pk))
        self.assertNotIn("password", response.data)
