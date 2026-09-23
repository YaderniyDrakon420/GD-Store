import uuid
from django.contrib.auth import get_user_model
from django.core.cache import cache
from rest_framework.test import APITestCase
from apps.accounts.models import Friendship
from .models import Conversation, Message
User = get_user_model()

class ChatTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.a = User.objects.create_user(username="alice", password="Strong-pass-22")
        self.b = User.objects.create_user(username="bob", password="Strong-pass-33")
        self.c = User.objects.create_user(username="other", password="Strong-pass-44")
        self.friend = Friendship.objects.create(from_user=self.a, to_user=self.b, status="accepted")
        self.client.force_authenticate(self.a)
        response = self.client.post("/api/v1/chat/conversations/", {"peer":str(self.b.pk)})
        self.assertEqual(response.status_code, 201, response.data)
        self.id = response.data["id"]
        self.url = f"/api/v1/chat/conversations/{self.id}/messages/"
    def send(self, **values):
        return self.client.post(self.url, {"text":"Привет", "client_id":str(uuid.uuid4()), **values})
    def test_authentication_required(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(self.url).status_code, 401)
    def test_unique_pair_in_both_directions(self):
        self.client.force_authenticate(self.b)
        response = self.client.post("/api/v1/chat/conversations/", {"peer":str(self.a.pk)})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["id"], self.id)
        self.assertEqual(Conversation.objects.count(), 1)
    def test_nonfriend_cannot_create(self):
        response = self.client.post("/api/v1/chat/conversations/", {"peer":str(self.c.pk)})
        self.assertEqual(response.status_code, 403)
    def test_self_conversation_rejected(self):
        self.assertEqual(self.client.post("/api/v1/chat/conversations/", {"peer":str(self.a.pk)}).status_code, 400)
    def test_foreign_read_send_and_mark_denied(self):
        message = self.send().data
        self.client.force_authenticate(self.c)
        self.assertEqual(self.client.get(self.url).status_code, 404)
        self.assertEqual(self.send().status_code, 404)
        self.assertEqual(self.client.post(f"/api/v1/chat/conversations/{self.id}/read/", {"message_id":message["id"]}).status_code,404)
        self.assertEqual(self.client.get("/api/v1/chat/conversations/").data["count"],0)
    def test_sender_cannot_be_spoofed(self):
        response=self.send(sender=str(self.b.pk))
        self.assertEqual(response.status_code,201)
        self.assertEqual(str(response.data["sender"]), str(self.a.pk))
    def test_send_is_idempotent(self):
        key=str(uuid.uuid4())
        a=self.send(client_id=key);b=self.send(client_id=key)
        self.assertEqual(a.status_code,201);self.assertEqual(b.status_code,200)
        self.assertEqual(a.data["id"],b.data["id"])
        self.assertEqual(Message.objects.count(),1)
    def test_key_cannot_be_reused_for_different_text(self):
        key=str(uuid.uuid4());self.send(client_id=key)
        self.assertEqual(self.send(client_id=key,text="different").status_code,400)
    def test_empty_long_and_invalid_messages_rejected(self):
        for text in ["", "   ", "x"*2001]: self.assertEqual(self.send(text=text).status_code,400)
        self.assertEqual(self.send(client_id="not-uuid").status_code,400)
    def test_block_prevents_both_directions_but_keeps_history(self):
        self.send();self.friend.status="blocked";self.friend.save()
        self.assertEqual(self.send().status_code,403)
        self.client.force_authenticate(self.b)
        self.assertEqual(self.send().status_code,403)
        self.assertEqual(len(self.client.get(self.url).data["results"]),1)
    def test_unfriend_prevents_new_messages(self):
        self.friend.delete();self.assertEqual(self.send().status_code,403)
    def test_unread_and_read_monotonic(self):
        one=self.send().data;two=self.send().data
        self.client.force_authenticate(self.b)
        self.assertEqual(self.client.get("/api/v1/chat/conversations/").data["results"][0]["unread"],2)
        url=f"/api/v1/chat/conversations/{self.id}/read/"
        self.assertEqual(self.client.post(url,{"message_id":two["id"]}).status_code,204)
        self.client.post(url,{"message_id":one["id"]})
        self.assertEqual(self.client.get("/api/v1/chat/conversations/").data["results"][0]["unread"],0)
    def test_read_rejects_message_from_another_conversation(self):
        obj=Conversation.objects.create(first=self.b,second=self.c)
        m=Message.objects.create(conversation=obj,sender=self.b,client_id=uuid.uuid4(),text="private")
        self.assertEqual(self.client.post(f"/api/v1/chat/conversations/{self.id}/read/",{"message_id":m.pk}).status_code,404)
    def test_cursor_pagination_has_no_duplicate_messages(self):
        Message.objects.bulk_create([Message(conversation_id=self.id,sender=self.a,client_id=uuid.uuid4(),text=str(i)) for i in range(65)])
        first=self.client.get(self.url).data
        second=self.client.get(first["next"]).data
        ids=[m["id"] for m in first["results"]+second["results"]]
        self.assertEqual(len(ids),65);self.assertEqual(len(set(ids)),65)
    def test_search_is_authenticated_and_does_not_expose_email(self):
        response=self.client.get("/api/v1/auth/users/?search=bo")
        self.assertEqual(response.data["count"],1)
        self.assertNotIn("email",response.data["results"][0])
        self.assertEqual(self.client.get("/api/v1/auth/users/?search=b").data["count"],0)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get("/api/v1/auth/users/?search=bo").status_code,401)

    def test_blocked_user_cannot_remove_or_overwrite_block(self):
        url=f"/api/v1/auth/friends/{self.friend.pk}/"
        self.assertEqual(self.client.post(url+"block/").status_code,200)
        self.client.force_authenticate(self.b)
        self.assertEqual(self.client.delete(url).status_code,400)
        self.assertEqual(self.client.post(url+"block/").status_code,400)
        self.assertEqual(self.send().status_code,403)
        self.client.force_authenticate(self.a)
        self.assertEqual(self.client.delete(url).status_code,204)

    def test_incremental_messages_do_not_skip_backlog(self):
        first=self.send().data["id"]
        Message.objects.bulk_create([Message(conversation_id=self.id,sender=self.a,client_id=uuid.uuid4(),text=str(i)) for i in range(65)])
        page=self.client.get(self.url+f"?after={first}").data
        rows=page["results"]+self.client.get(page["next"]).data["results"]
        self.assertEqual(len(rows),65)
        self.assertTrue(all(row["id"]>first for row in rows))
