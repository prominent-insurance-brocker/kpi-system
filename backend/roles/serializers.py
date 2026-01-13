from rest_framework import serializers
from .models import Role, RoleModulePermission


class RoleModulePermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = RoleModulePermission
        fields = ['module']


class RoleSerializer(serializers.ModelSerializer):
    module_permissions = serializers.ListField(
        child=serializers.CharField(),
        write_only=True,
        required=False
    )
    permissions = RoleModulePermissionSerializer(many=True, read_only=True)
    user_count = serializers.SerializerMethodField()

    class Meta:
        model = Role
        fields = [
            'id', 'name', 'description', 'data_visibility',
            'module_permissions', 'permissions', 'user_count',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_user_count(self, obj):
        return obj.users.count()

    def create(self, validated_data):
        module_permissions = validated_data.pop('module_permissions', [])
        role = Role.objects.create(**validated_data)

        for module in module_permissions:
            RoleModulePermission.objects.create(role=role, module=module)

        return role

    def update(self, instance, validated_data):
        module_permissions = validated_data.pop('module_permissions', None)

        # Update role fields
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()

        # Update permissions if provided
        if module_permissions is not None:
            instance.permissions.all().delete()
            for module in module_permissions:
                RoleModulePermission.objects.create(role=instance, module=module)

        return instance


class RoleListSerializer(serializers.ModelSerializer):
    """Simplified serializer for role dropdowns."""
    class Meta:
        model = Role
        fields = ['id', 'name']
