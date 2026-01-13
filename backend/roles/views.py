from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import Role, RoleModulePermission
from .serializers import RoleSerializer, RoleListSerializer
from .permissions import IsAdminUser


class RoleViewSet(viewsets.ModelViewSet):
    """ViewSet for managing roles (admin only)."""
    queryset = Role.objects.all()
    serializer_class = RoleSerializer
    permission_classes = [IsAdminUser]

    def get_serializer_class(self):
        if self.action == 'list' and self.request.query_params.get('simple'):
            return RoleListSerializer
        return RoleSerializer

    def destroy(self, request, *args, **kwargs):
        """Prevent deletion if users are assigned to the role."""
        instance = self.get_object()

        if instance.users.exists():
            return Response(
                {'error': f'Cannot delete role. {instance.users.count()} user(s) are assigned to this role.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        return super().destroy(request, *args, **kwargs)

    @action(detail=False, methods=['get'])
    def modules(self, request):
        """List all available modules."""
        return Response({
            'modules': [
                {'key': key, 'label': label}
                for key, label in RoleModulePermission.MODULE_CHOICES
            ]
        })
