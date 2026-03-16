import logging
from datetime import timedelta

from django.conf import settings
from django.core.mail import send_mail
from django.middleware.csrf import get_token
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from roles.permissions import IsAdminUser
from .models import CustomUser, MagicLink
from .serializers import UserSerializer, UserAdminSerializer

logger = logging.getLogger(__name__)


class RequestMagicLinkView(APIView):
    """Request a magic link for passwordless authentication."""
    permission_classes = [AllowAny]

    def post(self, request):
        email = request.data.get('email', '').lower().strip()

        if not email:
            return Response(
                {'error': 'Email is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Always return success message to prevent email enumeration
        success_message = {'message': 'If an account exists with this email, a login link has been sent.'}

        try:
            user = CustomUser.objects.get(email=email)
        except CustomUser.DoesNotExist:
            # Don't reveal if email exists
            return Response(success_message)

        if not user.is_active:
            return Response(
                {
                    'error': 'This account has been deactivated. Please contact an administrator.',
                    'redirect_after': 5
                },
                status=status.HTTP_403_FORBIDDEN
            )

        # Create magic link
        magic_link = MagicLink.create_for_user(user)

        # Build magic link URL
        link_url = f"{settings.FRONTEND_URL}/auth/verify?token={magic_link.token}"

        # Send email
        try:
            logger.info(f"Attempting to send magic link email to {user.email}")
            logger.info(f"Using EMAIL_HOST: {settings.EMAIL_HOST}, EMAIL_HOST_USER: {settings.EMAIL_HOST_USER}")

            send_mail(
                subject='Your login link for KPI System',
                message=f"""Hi {user.get_short_name()},

Click the link below to login to your account:
{link_url}

This link expires in 30 minutes.

If you didn't request this, please ignore this email.""",
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[user.email],
                fail_silently=False,
            )
            logger.info(f"Magic link email sent successfully to {user.email}")
        except Exception as e:
            logger.error(f"Failed to send email to {user.email}: {str(e)}", exc_info=True)
            return Response(
                {'error': f'Failed to send email. Please check email and try again.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

        return Response(success_message)


class VerifyMagicLinkView(APIView):
    """Verify a magic link token and issue JWT tokens."""
    permission_classes = [AllowAny]

    def get(self, request):
        token = request.query_params.get('token')
        remember_me = request.query_params.get('remember_me', 'false').lower() == 'true'

        if not token:
            return Response(
                {'error': 'Token is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            magic_link = MagicLink.objects.get(token=token)
        except MagicLink.DoesNotExist:
            return Response(
                {'error': 'Invalid or expired link. Please request a new one.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        if not magic_link.is_valid():
            return Response(
                {'error': 'Link expired or already used. Please request a new one.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        if not magic_link.user.is_active:
            return Response(
                {
                    'error': 'This account has been deactivated. Please contact an administrator.',
                    'redirect_after': 5
                },
                status=status.HTTP_403_FORBIDDEN
            )

        # Mark token as used
        magic_link.is_used = True
        magic_link.save()

        # Update last_login
        magic_link.user.last_login = timezone.now()
        magic_link.user.save(update_fields=['last_login'])

        # Generate JWT tokens
        refresh = RefreshToken.for_user(magic_link.user)
        access_token = str(refresh.access_token)
        refresh_token = str(refresh)

        # Set token lifetimes based on remember_me
        refresh_lifetime = 30 if remember_me else 7  # days

        response = Response({
            'message': 'Login successful',
            'user': UserSerializer(magic_link.user).data
        })

        # Set HTTP-only cookies
        response.set_cookie(
            key='access_token',
            value=access_token,
            httponly=True,
            secure=settings.DEBUG is False,
            samesite='Lax',
            max_age=settings.SIMPLE_JWT['ACCESS_TOKEN_LIFETIME'].total_seconds(),
        )
        response.set_cookie(
            key='refresh_token',
            value=refresh_token,
            httponly=True,
            secure=settings.DEBUG is False,
            samesite='Lax',
            max_age=timedelta(days=refresh_lifetime).total_seconds(),
        )

        return response


class LogoutView(APIView):
    """Logout and clear JWT cookies."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        response = Response({'message': 'Logout successful'})
        response.delete_cookie('access_token')
        response.delete_cookie('refresh_token')
        return response


class RefreshTokenView(APIView):
    """Refresh the access token using the refresh token cookie."""
    permission_classes = [AllowAny]

    def post(self, request):
        refresh_token = request.COOKIES.get('refresh_token')

        if not refresh_token:
            return Response(
                {'error': 'Refresh token not found'},
                status=status.HTTP_401_UNAUTHORIZED
            )

        try:
            refresh = RefreshToken(refresh_token)
            access_token = str(refresh.access_token)

            response = Response({'message': 'Token refreshed'})
            response.set_cookie(
                key='access_token',
                value=access_token,
                httponly=True,
                secure=settings.DEBUG is False,
                samesite='Lax',
                max_age=settings.SIMPLE_JWT['ACCESS_TOKEN_LIFETIME'].total_seconds(),
            )
            return response
        except Exception:
            return Response(
                {'error': 'Invalid refresh token'},
                status=status.HTTP_401_UNAUTHORIZED
            )


class UserDetailView(APIView):
    """Get the current authenticated user's details."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        serializer = UserSerializer(request.user)
        return Response(serializer.data)


class CSRFTokenView(APIView):
    """Get a CSRF token for form submissions."""
    permission_classes = [AllowAny]

    def get(self, request):
        return Response({'csrfToken': get_token(request)})


class UserViewSet(viewsets.ModelViewSet):
    """ViewSet for user management (admin only)."""
    queryset = CustomUser.objects.all().select_related('role')
    serializer_class = UserAdminSerializer
    permission_classes = [IsAdminUser]

    def get_queryset(self):
        queryset = super().get_queryset()
        # Optional filtering
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')
        return queryset.order_by('-date_joined')

    @action(detail=True, methods=['post'])
    def activate(self, request, pk=None):
        """Activate a user account."""
        user = self.get_object()
        user.is_active = True
        user.save(update_fields=['is_active'])
        return Response({'message': 'User activated successfully'})

    @action(detail=True, methods=['post'])
    def deactivate(self, request, pk=None):
        """Deactivate a user account."""
        user = self.get_object()

        # Prevent self-deactivation
        if user == request.user:
            return Response(
                {'error': 'You cannot deactivate your own account'},
                status=status.HTTP_400_BAD_REQUEST
            )

        user.is_active = False
        user.save(update_fields=['is_active'])
        return Response({'message': 'User deactivated successfully'})

    def destroy(self, request, *args, **kwargs):
        """Prevent self-deletion."""
        instance = self.get_object()

        if instance == request.user:
            return Response(
                {'error': 'You cannot delete your own account'},
                status=status.HTTP_400_BAD_REQUEST
            )

        return super().destroy(request, *args, **kwargs)
