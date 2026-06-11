import logging
import threading
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
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from roles.permissions import IsAdminUser
from .models import CustomUser, MagicLink
from .serializers import UserSerializer, UserAdminSerializer

logger = logging.getLogger(__name__)


def _send_magic_link_email(user, link_url):
    try:
        logger.info(f"Attempting to send magic link email to {user.email}")
        logger.info(
            f"Email config - BACKEND: {settings.EMAIL_BACKEND}, "
            f"HOST: {settings.EMAIL_HOST}, PORT: {settings.EMAIL_PORT}, "
            f"TLS: {settings.EMAIL_USE_TLS}, USER: {settings.EMAIL_HOST_USER}, "
            f"FROM: {settings.DEFAULT_FROM_EMAIL}, "
            f"CONSOLE_MODE: {getattr(settings, 'EMAIL_CONSOLE_MODE', 'not set')}"
        )

        result = send_mail(
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
        logger.info(f"Magic link email sent to {user.email}, send_mail returned: {result}")
    except Exception as e:
        logger.error(
            f"Failed to send email to {user.email}: {type(e).__name__}: {str(e)}",
            exc_info=True,
        )


class RequestMagicLinkView(APIView):
    """Request a magic link for passwordless authentication."""
    permission_classes = [AllowAny]
    throttle_scope = 'magic_link'

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
            logger.info(f"User found for email: {email}, is_active: {user.is_active}")
        except CustomUser.DoesNotExist:
            logger.warning(f"Magic link requested for non-existent email: {email}")
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

        threading.Thread(
            target=_send_magic_link_email,
            args=(user, link_url),
            daemon=True,
        ).start()

        return Response(success_message)


class VerifyMagicLinkView(APIView):
    """Verify a magic link token and issue JWT tokens.

    POST-only by design: corp inbox security scanners (Outlook ATP, Mimecast,
    Proofpoint, etc.) GET every URL in incoming email to scan it. If this
    endpoint were a GET that mutated state, the scanner would consume the
    token before the real user could click it — surfacing a spurious "Link
    expired or already used" error. Requiring POST means the token is only
    consumed on a confirmed user click from the verify page.
    """
    permission_classes = [AllowAny]

    def post(self, request):
        token = request.data.get('token') or request.query_params.get('token')
        remember_me_raw = request.data.get(
            'remember_me', request.query_params.get('remember_me', 'false')
        )
        remember_me = str(remember_me_raw).lower() == 'true'

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
    """Logout: blacklist the refresh token server-side, then clear cookies.

    Two things have to happen for a real logout:

    1. **Blacklist the refresh token.** Otherwise anyone who has a copy
       (DevTools, network capture, leaked cookie) can keep minting new
       access tokens for the lifetime of the refresh token (7-30 days).
    2. **Delete the cookies with the same attributes used to set them.** A
       bare ``response.delete_cookie('name')`` produces a non-Secure
       Set-Cookie header; many browsers refuse to overwrite the original
       Secure cookie with a non-Secure one, so the cookie sticks around
       and the user effectively stays logged in. Pass matching
       ``samesite``/``secure``/``path`` so the deletion lands.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        # 1. Blacklist the refresh token if present and parseable.
        refresh_cookie = request.COOKIES.get('refresh_token')
        if refresh_cookie:
            try:
                RefreshToken(refresh_cookie).blacklist()
            except TokenError:
                # Already blacklisted, expired, or malformed — nothing to do.
                pass

        # 2. Clear cookies with attributes that match VerifyMagicLinkView.
        # Django 4.2's `delete_cookie` doesn't accept ``secure`` — and without
        # it, the browser refuses to overwrite the original Secure cookie in
        # production. Use set_cookie with max_age=0 so we can pin every
        # attribute (path / samesite / secure / httponly) to match the set.
        response = Response({'message': 'Logout successful'})
        clear_kwargs = {
            'value': '',
            'max_age': 0,
            'path': '/',
            'samesite': 'Lax',
            'secure': not settings.DEBUG,
            'httponly': True,
        }
        response.set_cookie('access_token', **clear_kwargs)
        response.set_cookie('refresh_token', **clear_kwargs)
        return response


class RefreshTokenView(APIView):
    """Refresh the access token using the refresh token cookie."""
    permission_classes = [AllowAny]
    throttle_scope = 'auth_refresh'

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
        from django.db import models as db_models
        queryset = super().get_queryset()
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')
        module = self.request.query_params.get('module')
        if module:
            queryset = queryset.filter(
                db_models.Q(is_staff=True) |
                db_models.Q(role__permissions__module=module)
            ).distinct()

        # TED-521: admin Users-table filters.
        role_id = self.request.query_params.get('role_id')
        if role_id == 'none':
            queryset = queryset.filter(role__isnull=True)
        elif role_id and role_id.isdigit():
            queryset = queryset.filter(role_id=role_id)

        daily_email = self.request.query_params.get('daily_email_enabled')
        if daily_email is not None:
            queryset = queryset.filter(
                daily_email_enabled=daily_email.lower() == 'true'
            )

        # "today" / "yesterday" compared on the server day (TIME_ZONE = UTC,
        # matching how the rest of the app computes relative dates).
        last_login = self.request.query_params.get('last_login')
        if last_login in ('today', 'yesterday'):
            target = timezone.localdate()
            if last_login == 'yesterday':
                target = target - timedelta(days=1)
            queryset = queryset.filter(last_login__date=target)

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
        """Block self-deletion + block deletion when the user has data tied to them.

        Rule: a user can only be deleted when they have neither uploaded any
        entries themselves (`added_by`) NOR been assigned as the agent / source
        on someone else's entry (PROTECT FKs that would 500 the cascade anyway).
        Otherwise admins should deactivate the account instead.
        """
        instance = self.get_object()

        if instance == request.user:
            return Response(
                {'error': 'You cannot delete your own account.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        from entries.models import (
            GeneralNewEntry, GeneralRenewalEntry,
            MotorNewEntry, MotorRenewalEntry, MotorClaimEntry,
            SalesKPIEntry, MarineNewEntry, MarineRenewalEntry,
            MedicalClaimEntry,
        )
        # Motor Fleet models were added later; import defensively in case the
        # branch is run on an older codebase.
        try:
            from entries.models import MotorFleetNewEntry, MotorFleetRenewalEntry  # type: ignore
            fleet_models = [MotorFleetNewEntry, MotorFleetRenewalEntry]
        except ImportError:
            fleet_models = []

        uploader_models = [
            GeneralNewEntry, GeneralRenewalEntry,
            MotorNewEntry, MotorRenewalEntry, MotorClaimEntry,
            SalesKPIEntry, MarineNewEntry, MarineRenewalEntry,
            MedicalClaimEntry,
            *fleet_models,
        ]

        # 1. Has this user uploaded data themselves?
        uploaded = sum(M.objects.filter(added_by=instance).count() for M in uploader_models)
        if uploaded > 0:
            return Response(
                {
                    'error': (
                        f'This user has uploaded {uploaded} '
                        f'{"entry" if uploaded == 1 else "entries"}. '
                        'Deactivate the user instead of deleting.'
                    ),
                    'reason': 'has_uploaded_data',
                    'count': uploaded,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # 2. Are they referenced as agent / source on someone else's entry?
        #    Those FKs use on_delete=PROTECT, so without this check the
        #    DB would 500 with ProtectedError.
        agent_reverse_attrs = [
            'general_new_enquiries_as_agent',
            'general_renewal_enquiries_as_agent',
            'motor_new_enquiries_as_agent',
            'motor_renewal_enquiries_as_agent',
            'motor_claim_enquiries_as_source',
            'motor_fleet_new_enquiries_as_agent',
            'motor_fleet_renewal_enquiries_as_agent',
        ]
        agent_count = 0
        for attr in agent_reverse_attrs:
            mgr = getattr(instance, attr, None)
            if mgr is not None:
                agent_count += mgr.count()
        if agent_count > 0:
            return Response(
                {
                    'error': (
                        f'This user is assigned as the agent or source on '
                        f'{agent_count} {"enquiry" if agent_count == 1 else "enquiries"}. '
                        'Deactivate the user instead of deleting.'
                    ),
                    'reason': 'referenced_as_agent',
                    'count': agent_count,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        return super().destroy(request, *args, **kwargs)

    @action(
        detail=False,
        methods=['get'],
        url_path='module-members',
        permission_classes=[IsAuthenticated],
    )
    def module_members(self, request):
        """Paginated, searchable lookup of active users with a given module
        permission.

        Returns the minimum needed to populate agent/source pickers in entry
        forms (id, email, full_name). Authenticated to any logged-in user so
        non-admin entry creators can populate their dropdowns.

        Query params:
            module    (required) — module key, e.g. "sales_kpi"
            search    (optional) — case-insensitive match on first/last/email
            page      (optional, default 1)
            page_size (optional, default 20, capped at 200)
        """
        from django.db import models as db_models
        module = request.query_params.get('module')
        if not module:
            return Response(
                {'error': 'module query param is required'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        search = (request.query_params.get('search') or '').strip()
        try:
            page = max(int(request.query_params.get('page', 1)), 1)
            page_size = min(max(int(request.query_params.get('page_size', 20)), 1), 200)
        except (TypeError, ValueError):
            return Response(
                {'error': 'page and page_size must be integers'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        qs = (
            CustomUser.objects
            .filter(is_active=True)
            .filter(
                db_models.Q(is_staff=True) |
                db_models.Q(role__permissions__module=module)
            )
            .distinct()
            .order_by('full_name', 'email', 'id')
        )
        if search:
            qs = qs.filter(
                db_models.Q(full_name__icontains=search) |
                db_models.Q(email__icontains=search)
            )

        total = qs.count()
        offset = (page - 1) * page_size
        users = qs[offset:offset + page_size]
        data = [
            {'id': u.id, 'email': u.email, 'full_name': u.get_full_name()}
            for u in users
        ]
        return Response({
            'results': data,
            'count': total,
            'has_more': offset + len(data) < total,
        })

    @action(
        detail=False,
        methods=['get'],
        url_path='active',
        permission_classes=[IsAuthenticated],
    )
    def active_users(self, request):
        """TED-513: paginated, searchable list of ALL active users.

        Same response shape as `module_members` so SearchableSelect can swap
        between the two without consumer changes. Use this for pickers
        (assignee, agent, source, etc.) when the picker should not be scoped
        to a single module's permission set.
        """
        from django.db import models as db_models
        search = (request.query_params.get('search') or '').strip()
        try:
            page = max(int(request.query_params.get('page', 1)), 1)
            page_size = min(max(int(request.query_params.get('page_size', 20)), 1), 200)
        except (TypeError, ValueError):
            return Response(
                {'error': 'page and page_size must be integers'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        qs = (
            CustomUser.objects
            .filter(is_active=True)
            .order_by('full_name', 'email', 'id')
        )
        if search:
            qs = qs.filter(
                db_models.Q(full_name__icontains=search) |
                db_models.Q(email__icontains=search)
            )

        total = qs.count()
        offset = (page - 1) * page_size
        users = qs[offset:offset + page_size]
        data = [
            {'id': u.id, 'email': u.email, 'full_name': u.get_full_name()}
            for u in users
        ]
        return Response({
            'results': data,
            'count': total,
            'has_more': offset + len(data) < total,
        })
