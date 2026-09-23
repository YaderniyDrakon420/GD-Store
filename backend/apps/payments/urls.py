from django.urls import path

from . import views

urlpatterns = [
    path("create/", views.CreatePaymentView.as_view()),
    path("webhook/", views.PaymentWebhookView.as_view()),
]
