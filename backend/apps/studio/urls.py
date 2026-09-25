from django.urls import path
from .auth import AccountView
from .views import SnapshotView, CommandView, QuoteView
from .files import UploadView, DownloadView
from .attachments import AttachmentUploadView, AttachmentView, ChatActivityView
from .security import SecurityView

urlpatterns = [path("account/", AccountView.as_view()), path("snapshot/", SnapshotView.as_view()),
               path("commands/", CommandView.as_view()), path("quote/", QuoteView.as_view()),
               path("uploads/", UploadView.as_view()), path("mods/<uuid:pk>/download/", DownloadView.as_view()),
               path("attachments/", AttachmentUploadView.as_view()), path("attachments/<uuid:pk>/", AttachmentView.as_view()),
               path("chat-activity/", ChatActivityView.as_view()), path("security/", SecurityView.as_view())]
