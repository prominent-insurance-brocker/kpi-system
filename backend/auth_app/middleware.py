"""Middleware that records the authenticated actor for audit logging.

See ``auth_app.audit_context`` for why this exists: cookie-JWT auth resolves the
user at the DRF view layer, *after* Django middleware runs, so the audit signals
can't see ``request.user``. This middleware decodes the same ``access_token``
cookie up-front using the project's ``CookieJWTAuthentication`` and stashes the
actor in a context variable that the audit signal handlers read.

Must be listed *after* ``AuthenticationMiddleware`` so the session-user fallback
(for Django-admin writes, which carry no access_token cookie) works.
"""
from .audit_context import reset, set_actor
from .authentication import CookieJWTAuthentication


def _client_ip(request):
    forwarded = request.META.get('HTTP_X_FORWARDED_FOR', '')
    if forwarded:
        # Behind Traefik/nginx; the left-most entry is the original client.
        return forwarded.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR')


class AuditActorMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response
        self._authenticator = CookieJWTAuthentication()

    def __call__(self, request):
        user = None
        try:
            result = self._authenticator.authenticate(request)
            if result is not None:
                user, _token = result
        except Exception:
            # Expired / invalid / malformed token -> treat as anonymous here.
            # The real auth error (if any) is surfaced by DRF in the view.
            user = None

        # Fallback: attribute Django-admin / session writes (no access_token
        # cookie) to their session user when one is present.
        if user is None:
            session_user = getattr(request, 'user', None)
            if session_user is not None and getattr(session_user, 'is_authenticated', False):
                user = session_user

        tokens = set_actor(user, _client_ip(request))
        try:
            return self.get_response(request)
        finally:
            reset(tokens)
