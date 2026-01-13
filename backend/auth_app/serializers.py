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
        fields = ['id', 'email', 'first_name', 'last_name', 'is_staff', 'is_active', 'role', 'date_joined']
        read_only_fields = ['id', 'date_joined', 'is_staff']


class UserAdminSerializer(serializers.ModelSerializer):
    """Serializer for admin user management."""
    role_name = serializers.SerializerMethodField()
    role_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)

    class Meta:
        model = CustomUser
        fields = [
            'id', 'email', 'first_name', 'last_name',
            'is_staff', 'is_active', 'role_id', 'role_name',
            'date_joined', 'last_login'
        ]
        read_only_fields = ['id', 'date_joined', 'last_login']

    def get_role_name(self, obj):
        return obj.role.name if obj.role else None

    def to_representation(self, instance):
        """Add role_id to the output."""
        ret = super().to_representation(instance)
        ret['role_id'] = instance.role_id
        return ret

    def create(self, validated_data):
        # Extract role_id and convert to role
        role_id = validated_data.pop('role_id', None)
        role = None
        if role_id:
            role = Role.objects.filter(id=role_id).first()

        # Create user without password (magic link only)
        user = CustomUser.objects.create_user(
            email=validated_data['email'],
            password=None,  # No password for magic link auth
            first_name=validated_data.get('first_name', ''),
            last_name=validated_data.get('last_name', ''),
            role=role,
            is_staff=validated_data.get('is_staff', False),
            is_active=validated_data.get('is_active', True),
        )
        return user

    def update(self, instance, validated_data):
        # Handle role_id separately
        role_id = validated_data.pop('role_id', None)
        if role_id is not None:
            instance.role = Role.objects.filter(id=role_id).first()
        elif 'role_id' in self.initial_data and self.initial_data['role_id'] is None:
            instance.role = None

        # Update other fields
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        return instance
