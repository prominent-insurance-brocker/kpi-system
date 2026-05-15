from rest_framework.permissions import BasePermission


def user_is_hod(user):
    """Return True for non-admin users whose role has is_hod=True.

    HOD (Head of Department) is an oversight role: sees all team data but
    cannot create/edit/delete entries or targets. Admins (is_staff=True) are
    excluded by design — they keep their full admin privileges regardless.
    """
    if not user or not user.is_authenticated or user.is_staff:
        return False
    role = getattr(user, 'role', None)
    return bool(role and role.is_hod)


class HasModulePermission(BasePermission):
    """
    Permission class to check if user has access to a specific module.
    The viewset must have a `module_key` attribute set.
    """

    def has_permission(self, request, view):
        # Must be authenticated
        if not request.user or not request.user.is_authenticated:
            return False

        # Staff/admin can access everything
        if request.user.is_staff:
            return True

        # Get module_key from the view
        module_key = getattr(view, 'module_key', None)
        if not module_key:
            # No module_key set, deny access by default
            return False

        # Check if user has a role with this module permission
        user = request.user
        if not hasattr(user, 'role') or not user.role:
            return False

        return user.role.permissions.filter(module=module_key).exists()


class IsAdminUser(BasePermission):
    """
    Permission class to check if user is an admin (staff).
    """

    def has_permission(self, request, view):
        return (
            request.user and
            request.user.is_authenticated and
            request.user.is_staff
        )
