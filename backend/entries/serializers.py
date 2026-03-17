from rest_framework import serializers
from .models import (
    GeneralNewEntry,
    GeneralRenewalEntry,
    MotorNewEntry,
    MotorRenewalEntry,
    MotorClaimEntry,
    SalesPremiumDataEntry,
    SalesKPIEntry,
    MarineNewEntry,
    MarineRenewalEntry,
    MedicalClaimEntry,
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


class SalesPremiumDataEntrySerializer(BaseEntrySerializer):
    class Meta:
        model = SalesPremiumDataEntry
        fields = [
            'id', 'date', 'gross_booked_premium', 'target',
            'added_by', 'added_by_name', 'added_at', 'updated_at', 'is_editable'
        ]
        read_only_fields = ['id', 'added_by', 'added_at', 'updated_at']


class SalesKPIEntrySerializer(BaseEntrySerializer):
    class Meta:
        model = SalesKPIEntry
        fields = [
            'id', 'date', 'leads_to_ops_team', 'quotes_from_ops_team',
            'quotes_to_client', 'total_conversions', 'existing_clients',
            'existing_clients_closed', 'new_clients_acquired',
            'added_by', 'added_by_name', 'added_at', 'updated_at', 'is_editable'
        ]
        read_only_fields = ['id', 'added_by', 'added_at', 'updated_at']


class MarineNewEntrySerializer(BaseEntrySerializer):
    class Meta:
        model = MarineNewEntry
        fields = [
            'id', 'date', 'gross_booked_premium', 'quotes_created',
            'new_clients_acquired', 'new_policies_issued',
            'added_by', 'added_by_name', 'added_at', 'updated_at', 'is_editable'
        ]
        read_only_fields = ['id', 'added_by', 'added_at', 'updated_at']


class MarineRenewalEntrySerializer(BaseEntrySerializer):
    class Meta:
        model = MarineRenewalEntry
        fields = [
            'id', 'date', 'monthly_renewal_quotes_assigned', 'gross_booked_premium',
            'quotes_created', 'renewal_policies_issued',
            'added_by', 'added_by_name', 'added_at', 'updated_at', 'is_editable'
        ]
        read_only_fields = ['id', 'added_by', 'added_at', 'updated_at']


class MedicalClaimEntrySerializer(BaseEntrySerializer):
    tat_display = serializers.SerializerMethodField()
    allowed_transitions = serializers.SerializerMethodField()
    is_terminal = serializers.SerializerMethodField()

    class Meta:
        model = MedicalClaimEntry
        fields = [
            'id', 'date', 'customer_name', 'status',
            'added_by', 'added_by_name', 'added_at', 'updated_at', 'is_editable',
            'tat_display', 'allowed_transitions', 'is_terminal'
        ]
        read_only_fields = ['id', 'added_by', 'added_at', 'updated_at']

    def get_tat_display(self, obj):
        return obj.get_tat_display()

    def get_allowed_transitions(self, obj):
        return MedicalClaimEntry.get_allowed_transitions(obj.status)

    def get_is_terminal(self, obj):
        return obj.is_terminal

    def validate_accuracy(self, value):
        return value


class MedicalClaimStatusUpdateSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=MedicalClaimEntry.STATUS_CHOICES)

    def validate_status(self, value):
        entry = self.context['entry']
        allowed = MedicalClaimEntry.get_allowed_transitions(entry.status)
        if value not in allowed:
            current_label = dict(MedicalClaimEntry.STATUS_CHOICES).get(entry.status)
            allowed_labels = [dict(MedicalClaimEntry.STATUS_CHOICES).get(s) for s in allowed]
            raise serializers.ValidationError(
                f"Cannot transition from '{current_label}' to "
                f"'{dict(MedicalClaimEntry.STATUS_CHOICES).get(value)}'. "
                f"Allowed: {allowed_labels}"
            )
        return value
