from rest_framework import serializers

from .models import AuditLog
from .registry import CATEGORY_LABELS


class AuditLogSerializer(serializers.ModelSerializer):
    """Read-only serializer for the admin audit trail."""
    category_label = serializers.SerializerMethodField()
    action_display = serializers.CharField(source='get_action_display', read_only=True)
    actor_name = serializers.SerializerMethodField()
    actor_email = serializers.SerializerMethodField()

    class Meta:
        model = AuditLog
        fields = [
            'id', 'timestamp', 'category', 'category_label', 'model_label',
            'action', 'action_display', 'actor', 'actor_name', 'actor_email',
            'object_label', 'content_type', 'object_id', 'changes', 'ip_address',
        ]
        read_only_fields = fields

    def get_category_label(self, obj):
        return CATEGORY_LABELS.get(obj.category, obj.category)

    def get_actor_name(self, obj):
        if obj.actor_id and obj.actor:
            return obj.actor.get_full_name()
        return 'System'

    def get_actor_email(self, obj):
        if obj.actor_id and obj.actor:
            return obj.actor.email
        return None
