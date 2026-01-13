from rest_framework.permissions import BasePermission


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
