from django.contrib import admin
from .models import Role, RoleModulePermission

class RoleModulePermissionInline(admin.TabularInline):
    model = RoleModulePermission
    extra = 1

@admin.register(Role)
class RoleAdmin(admin.ModelAdmin):
    list_display = ('name', 'data_visibility', 'created_at')
    list_filter = ('data_visibility',)
    search_fields = ('name', 'description')
    inlines = [RoleModulePermissionInline]

@admin.register(RoleModulePermission)
class RoleModulePermissionAdmin(admin.ModelAdmin):
    list_display = ('role', 'module')
    list_filter = ('role', 'module')
