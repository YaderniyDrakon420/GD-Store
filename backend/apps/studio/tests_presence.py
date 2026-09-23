from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import Friendship
from .models import PresenceSession, Profile

ROOT = '/api/v1/studio/'


class PresenceTests(TestCase):
    def setUp(self):
        self.alice = get_user_model().objects.create_user(username='alice', password='Test-strong-pass-42')
        self.bob = get_user_model().objects.create_user(username='bob', password='Test-strong-pass-42')
        self.a, self.b = APIClient(), APIClient()
        self.a.force_login(self.alice)
        self.b.force_login(self.bob)

    def status(self, client, user):
        response = client.get(ROOT + 'snapshot/')
        self.assertEqual(response.status_code, 200)
        return next(u for u in response.data['state']['users'] if u['id'] == str(user.pk))

    def test_presence_appears_for_friend_then_expires_and_reconnects(self):
        self.assertEqual(self.status(self.b, self.alice)['status'], 'offline')
        self.assertEqual(self.status(self.a, self.alice)['status'], 'online')
        self.assertEqual(self.status(self.b, self.alice)['status'], 'online')
        PresenceSession.objects.filter(user=self.alice).update(last_seen=timezone.now() - timedelta(seconds=91))
        self.assertEqual(self.status(self.b, self.alice)['status'], 'offline')
        self.status(self.a, self.alice)
        self.assertEqual(self.status(self.b, self.alice)['status'], 'online')

    def test_logout_one_device_keeps_other_and_last_logout_goes_offline(self):
        second = APIClient()
        second.force_login(self.alice)
        self.status(self.a, self.alice)
        self.status(second, self.alice)
        self.assertEqual(PresenceSession.objects.filter(user=self.alice).count(), 2)
        self.assertEqual(self.a.post(ROOT + 'account/', {'mode': 'logout'}, format='json').status_code, 200)
        self.assertEqual(self.status(self.b, self.alice)['status'], 'online')
        second.logout()
        self.assertEqual(self.status(self.b, self.alice)['status'], 'offline')

    def test_tabs_share_browser_session_without_creating_duplicate_rows(self):
        tab = APIClient()
        tab.cookies = self.a.cookies.copy()
        self.status(self.a, self.alice)
        self.status(tab, self.alice)
        self.assertEqual(PresenceSession.objects.filter(user=self.alice).count(), 1)
        self.assertEqual(self.status(self.b, self.alice)['status'], 'online')

    def test_manual_invisible_and_playing_never_override_connectivity(self):
        p = Profile.objects.create(user=self.alice, appearance={'status': 'offline'})
        own = self.status(self.a, self.alice)
        self.assertEqual(own['statusPreference'], 'offline')
        self.assertEqual(self.status(self.b, self.alice)['status'], 'offline')
        p.appearance = {'status': 'playing'}
        p.save()
        self.assertEqual(self.status(self.b, self.alice)['status'], 'playing')
        PresenceSession.objects.filter(user=self.alice).update(last_seen=timezone.now() - timedelta(seconds=91))
        self.assertEqual(self.status(self.b, self.alice)['status'], 'offline')
        # Editing an offline profile must not accidentally select invisible.
        with patch('apps.studio.views.touch_presence'):
            own = self.status(self.a, self.alice)
        self.assertEqual(own['statusPreference'], 'playing')
        self.assertEqual(own['status'], 'offline')

    def test_blocked_and_disabled_users_do_not_appear_online(self):
        self.status(self.a, self.alice)
        Friendship.objects.create(from_user=self.alice, to_user=self.bob, status='blocked', blocked_by=self.bob)
        self.assertEqual(self.status(self.b, self.alice)['status'], 'offline')
        Friendship.objects.all().delete()
        self.alice.is_active = False
        self.alice.save()
        self.assertEqual(self.status(self.b, self.alice)['status'], 'offline')

    def test_guests_do_not_create_presence_and_session_identifiers_stay_private(self):
        guest = APIClient()
        self.status(guest, self.alice)
        self.assertEqual(PresenceSession.objects.count(), 0)
        self.status(self.a, self.alice)
        result = self.status(self.b, self.alice)
        self.assertNotIn('statusPreference', result)
        self.assertNotIn('last_seen', result)
        raw = self.a.session.session_key
        row = PresenceSession.objects.get(user=self.alice)
        self.assertNotEqual(raw, row.session_hash)
        self.assertNotIn(row.session_hash, str(self.b.get(ROOT + 'snapshot/').data))

    def test_timestamp_writes_are_coalesced_and_old_leases_cleaned(self):
        now = timezone.now()
        with patch('apps.studio.presence.timezone.now', return_value=now):
            self.status(self.a, self.alice)
        with patch('apps.studio.presence.timezone.now', return_value=now + timedelta(seconds=10)):
            self.status(self.a, self.alice)
        self.assertEqual(PresenceSession.objects.get(user=self.alice).last_seen, now)
        PresenceSession.objects.create(session_hash='old', user=self.bob, last_seen=now - timedelta(days=2))
        with patch('apps.studio.presence.timezone.now', return_value=now + timedelta(seconds=21)):
            self.status(self.a, self.alice)
        self.assertEqual(PresenceSession.objects.get(user=self.alice).last_seen, now + timedelta(seconds=21))
        self.assertFalse(PresenceSession.objects.filter(pk='old').exists())

    def test_login_switch_removes_old_presence_and_logout_has_no_ghost(self):
        self.status(self.a, self.alice)
        result = self.a.post(ROOT + 'account/', {'mode': 'login', 'login': 'bob', 'password': 'Test-strong-pass-42'}, format='json')
        self.assertEqual(result.status_code, 200)
        self.assertFalse(PresenceSession.objects.filter(user=self.alice).exists())
        self.status(self.a, self.bob)
        self.a.post(ROOT + 'account/', {'mode': 'logout'}, format='json')
        self.assertFalse(PresenceSession.objects.exists())


@override_settings(CORS_ALLOWED_ORIGINS=['https://store.example.com'],
                   CSRF_TRUSTED_ORIGINS=['https://store.example.com'])
class SplitHostingTests(TestCase):
    def setUp(self):
        get_user_model().objects.create_user(username='alice', password='Test-strong-pass-42')
        self.client = APIClient(enforce_csrf_checks=True)

    def test_allowed_frontend_preflight_and_cookie_session_login(self):
        origin = 'https://store.example.com'
        preflight = self.client.options(ROOT + 'commands/', HTTP_ORIGIN=origin,
            HTTP_ACCESS_CONTROL_REQUEST_METHOD='POST',
            HTTP_ACCESS_CONTROL_REQUEST_HEADERS='content-type,x-csrftoken,idempotency-key,x-store-user')
        self.assertEqual(preflight['Access-Control-Allow-Origin'], origin)
        self.assertEqual(preflight['Access-Control-Allow-Credentials'], 'true')
        for header in ('x-csrftoken', 'idempotency-key', 'x-store-user'):
            self.assertIn(header, preflight['Access-Control-Allow-Headers'])
        first = self.client.get(ROOT + 'snapshot/', HTTP_ORIGIN=origin)
        response = self.client.post(ROOT + 'account/', {'mode': 'login', 'login': 'alice', 'password': 'Test-strong-pass-42'},
            format='json', HTTP_ORIGIN=origin, HTTP_X_CSRFTOKEN=first.data['csrf'])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Access-Control-Allow-Origin'], origin)
        snapshot = self.client.get(ROOT + 'snapshot/', HTTP_ORIGIN=origin)
        self.assertIsNotNone(snapshot.data['state']['active'])
        self.assertEqual(snapshot.data['state']['users'][0]['status'], 'online')
        self.assertEqual(snapshot['Cache-Control'], 'no-store')

    def test_untrusted_origin_and_missing_csrf_still_rejected(self):
        csrf = self.client.get(ROOT + 'snapshot/').data['csrf']
        login = {'mode': 'login', 'login': 'alice', 'password': 'Test-strong-pass-42'}
        response = self.client.post(ROOT + 'account/', login, format='json',
            HTTP_ORIGIN='https://untrusted.example', HTTP_X_CSRFTOKEN=csrf)
        self.assertEqual(response.status_code, 403)
        self.assertNotIn('Access-Control-Allow-Origin', response)
        response = self.client.post(ROOT + 'account/', login, format='json', HTTP_ORIGIN='https://store.example.com')
        self.assertEqual(response.status_code, 403)
