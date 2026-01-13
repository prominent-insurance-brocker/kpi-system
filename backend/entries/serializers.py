from rest_framework import serializers
from .models import (
    GeneralNewEntry,
    GeneralRenewalEntry,
    MotorNewEntry,
    MotorRenewalEntry,
    MotorClaimEntry,
)


class BaseEntrySerializer(serializers.ModelSerializer):
    """Base serializer for all entry types."""
    added_by_name = serializers.SerializerMethodField()
    is_editable = serializers.SerializerMethodField()

    def get_added_by_name(self, obj):
        return obj.added_by.get_full_name()

    def get_is_editable(self, obj):
        request = self.context.get('request')
        if not request or not request.user:
            return False
        return obj.can_edit(request.user)

    def validate_accuracy(self, value):
        if value < 0 or value > 100:
            raise serializers.ValidationError("Accuracy must be between 0 and 100")
        return value


class GeneralNewEntrySerializer(BaseEntrySerializer):
    class Meta:
        model = GeneralNewEntry
        fields = [
            'id', 'date', 'quotations', 'quotes_revised', 'quotes_converted',
            'tat', 'accuracy', 'added_by', 'added_by_name', 'added_at',
            'updated_at', 'is_editable'
        ]
        read_only_fields = ['id', 'added_by', 'added_at', 'updated_at']


class GeneralRenewalEntrySerializer(BaseEntrySerializer):
    class Meta:
        model = GeneralRenewalEntry
        fields = [
            'id', 'date', 'quotations', 'quotes_revised', 'quotes_converted',
            'tat', 'accuracy', 'added_by', 'added_by_name', 'added_at',
            'updated_at', 'is_editable'
        ]
        read_only_fields = ['id', 'added_by', 'added_at', 'updated_at']


class MotorNewEntrySerializer(BaseEntrySerializer):
    class Meta:
        model = MotorNewEntry
        fields = [
            'id', 'date', 'quotations', 'quotes_revised', 'tat', 'accuracy',
            'added_by', 'added_by_name', 'added_at', 'updated_at', 'is_editable'
        ]
        read_only_fields = ['id', 'added_by', 'added_at', 'updated_at']


class MotorRenewalEntrySerializer(BaseEntrySerializer):
    class Meta:
        model = MotorRenewalEntry
        fields = [
            'id', 'date', 'quotations', 'retention', 'tat', 'accuracy',
            'added_by', 'added_by_name', 'added_at', 'updated_at', 'is_editable'
        ]
        read_only_fields = ['id', 'added_by', 'added_at', 'updated_at']


class MotorClaimEntrySerializer(BaseEntrySerializer):
    class Meta:
        model = MotorClaimEntry
        fields = [
            'id', 'date', 'registered_claims', 'claims_closed', 'pending_cases',
            'tat', 'added_by', 'added_by_name', 'added_at', 'updated_at', 'is_editable'
        ]
        read_only_fields = ['id', 'added_by', 'added_at', 'updated_at']

    def validate_accuracy(self, value):
        # Motor Claim doesn't have accuracy field, skip validation
        return value
