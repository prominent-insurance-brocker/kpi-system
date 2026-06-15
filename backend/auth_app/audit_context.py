"""Request-scoped audit actor context.

Auth in this project is JWT-in-HTTP-only-cookie, decoded by
``CookieJWTAuthentication`` at the DRF *view* layer. At normal Django
middleware/signal time ``request.user`` is therefore ``AnonymousUser``, so the
audit signals (which receive no request) cannot see who is acting.
``AuditActorMiddleware`` decodes the cookie up-front and stashes the actor here;
the audit signal handlers in ``audit.signals`` read it when writing a row.

A ``ContextVar`` is used (rather than ``threading.local``) so the value is
correctly isolated per request and safe under async handlers.
"""
from contextvars import ContextVar

_actor_id: ContextVar = ContextVar('audit_actor_id', default=None)
_ip_address: ContextVar = ContextVar('audit_ip_address', default=None)


def set_actor(user, ip_address=None):
    """Stash the acting user id + client IP for the current request.

    Returns the ContextVar reset tokens so the middleware can restore the
    previous state in a ``finally`` block (prevents leakage across pooled
    worker threads / reused contexts).
    """
    if user is not None and getattr(user, 'is_authenticated', False):
        uid = user.pk
    else:
        uid = None
    return (_actor_id.set(uid), _ip_address.set(ip_address))


def reset(tokens):
    """Restore the previous context state from ``set_actor``'s tokens."""
    actor_token, ip_token = tokens
    _actor_id.reset(actor_token)
    _ip_address.reset(ip_token)


def get_actor_id():
    """Return the acting user's id for the current request, or None."""
    return _actor_id.get()


def get_ip_address():
    """Return the client IP for the current request, or None."""
    return _ip_address.get()
