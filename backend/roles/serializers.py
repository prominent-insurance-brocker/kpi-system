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
            'id', 'name', 'description', 'data_visibility', 'is_hod',
            'module_permissions', 'permissions', 'user_count',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_user_count(self, obj):
        return obj.users.count()

    def validate(self, attrs):
        """HOD roles must oversee at least one module — otherwise the user has
        no data to oversee. Applies to both create and update (PATCH).
        """
        attrs = super().validate(attrs)

        # Determine the effective is_hod after this write. On PATCH, fall back
        # to the current value if the field wasn't sent.
        is_hod = attrs.get('is_hod')
        if is_hod is None and self.instance is not None:
            is_hod = self.instance.is_hod

        if not is_hod:
            return attrs

        # If module_permissions wasn't included in the payload (PATCH leaving
        # them untouched), use the instance's current permissions.
        if 'module_permissions' in attrs:
            modules = attrs['module_permissions']
        elif self.instance is not None:
            modules = list(self.instance.permissions.values_list('module', flat=True))
        else:
            modules = []

        if not modules:
            raise serializers.ValidationError({
                'module_permissions': 'HOD roles must have at least one module permission.',
            })
        return attrs

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
