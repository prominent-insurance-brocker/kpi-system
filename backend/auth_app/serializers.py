from rest_framework import serializers
from .models import CustomUser
from roles.models import Role


class RoleNestedSerializer(serializers.ModelSerializer):
    """Nested serializer for role in user responses."""
    module_permissions = serializers.SerializerMethodField()

    class Meta:
        model = Role
        fields = ['id', 'name', 'data_visibility', 'module_permissions']

    def get_module_permissions(self, obj):
        return list(obj.permissions.values_list('module', flat=True))


class UserSerializer(serializers.ModelSerializer):
    """Serializer for user details (includes role info)."""
    role = RoleNestedSerializer(read_only=True)

    class Meta:
        model = CustomUser
        fields = ['id', 'email', 'full_name', 'is_staff', 'is_active', 'role', 'date_joined']
        read_only_fields = ['id', 'date_joined', 'is_staff']


class UserAdminSerializer(serializers.ModelSerializer):
    """Serializer for admin user management."""
    role_name = serializers.SerializerMethodField()
    role_id = serializers.PrimaryKeyRelatedField(
        source='role',
        queryset=Role.objects.all(),
        allow_null=True,
        required=False,
    )

    class Meta:
        model = CustomUser
        fields = [
            'id', 'email', 'full_name',
            'is_staff', 'is_active', 'role_id', 'role_name',
            'date_joined', 'last_login'
        ]
        read_only_fields = ['id', 'date_joined', 'last_login']

    def get_role_name(self, obj):
        return obj.role.name if obj.role else None

    def create(self, validated_data):
        # Magic-link auth: no password.
        role = validated_data.pop('role', None)
        user = CustomUser.objects.create_user(
            email=validated_data['email'],
            password=None,
            full_name=validated_data.get('full_name', ''),
            role=role,
            is_staff=validated_data.get('is_staff', False),
            is_active=validated_data.get('is_active', True),
        )
        return user
