from django.urls import path
from .views import LoginView, LogoutView, RefreshTokenView, UserDetailView, CSRFTokenView

urlpatterns = [
    path('login/', LoginView.as_view(), name='login'),
    path('logout/', LogoutView.as_view(), name='logout'),
    path('refresh/', RefreshTokenView.as_view(), name='token_refresh'),
    path('user/', UserDetailView.as_view(), name='user_detail'),
    path('csrf/', CSRFTokenView.as_view(), name='csrf_token'),
]
