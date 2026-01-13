from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    RequestMagicLinkView,
    VerifyMagicLinkView,
    LogoutView,
    RefreshTokenView,
    UserDetailView,
    CSRFTokenView,
    UserViewSet,
)

router = DefaultRouter()
router.register(r'users', UserViewSet, basename='user')

urlpatterns = [
    path('magic-link/request/', RequestMagicLinkView.as_view(), name='request_magic_link'),
    path('magic-link/verify/', VerifyMagicLinkView.as_view(), name='verify_magic_link'),
    path('logout/', LogoutView.as_view(), name='logout'),
    path('refresh/', RefreshTokenView.as_view(), name='token_refresh'),
    path('user/', UserDetailView.as_view(), name='user_detail'),
    path('csrf/', CSRFTokenView.as_view(), name='csrf_token'),
    path('', include(router.urls)),
]
