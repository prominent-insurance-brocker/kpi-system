from rest_framework import serializers
from .models import (
    GeneralNewEntry,
    GeneralRenewalEntry,
    MotorNewEntry,
    MotorNewStatusTransition,
    MotorRenewalEntry,
    MotorRenewalStatusTransition,
    MotorRenewalMonthlyTarget,
    MotorClaimEntry,
    MotorClaimStatusTransition,
    TypeOfAccident,
    InsuranceCompany,
    SalesKPIEntry,
    SalesMonthlyTarget,
    MarineNewEntry,
    MarineRenewalEntry,
    MedicalClaimEntry,
)


class BaseEntrySerializer(serializers.ModelSerializer):
    """Base serializer for all entry types."""
    added_by_name = serializers.SerializerMethodField()
    on_behalf_of_name = serializers.SerializerMethodField()
    is_editable = serializers.SerializerMethodField()

    # Subclasses set this to False for claim modules (motor_claim, medical_claim).
    enforce_one_per_day = True

    def get_added_by_name(self, obj):
        return obj.added_by.get_full_name()

    def get_on_behalf_of_name(self, obj):
        if obj.on_behalf_of_id is None:
            return None
        return obj.on_behalf_of.get_full_name()

    def get_is_editable(self, obj):
        request = self.context.get('request')
        if not request or not request.user:
            return False
        return obj.can_edit(request.user)

    def validate_accuracy(self, value):
        if value < 0 or value > 100:
            raise serializers.ValidationError("Accuracy must be between 0 and 100")
        return value

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if not self.enforce_one_per_day:
            return attrs
        request = self.context.get('request')
        if request is None:
            return attrs

        date = attrs.get('date') or (self.instance and self.instance.date)
        if date is None:
            return attrs

        Model = self.Meta.model
        qs = Model.objects.filter(date=date, added_by=request.user)
        if self.instance is not None:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError(
                {'date': 'An entry for this date already exists for this user.'}
            )
        return attrs


class GeneralNewEntrySerializer(BaseEntrySerializer):
    class Meta:
        model = GeneralNewEntry
        fields = [
            'id', 'date', 'quotations', 'quotes_revised', 'quotes_converted',
            'tat', 'accuracy', 'added_by', 'added_by_name',
            'on_behalf_of', 'on_behalf_of_name',
            'added_at', 'updated_at', 'is_editable'
        ]
        read_only_fields = ['id', 'added_by', 'on_behalf_of', 'added_at', 'updated_at']


class GeneralRenewalEntrySerializer(BaseEntrySerializer):
    class Meta:
        model = GeneralRenewalEntry
        fields = [
            'id', 'date', 'quotations', 'quotes_revised', 'quotes_converted',
            'tat', 'accuracy', 'added_by', 'added_by_name',
            'on_behalf_of', 'on_behalf_of_name',
            'added_at', 'updated_at', 'is_editable'
        ]
        read_only_fields = ['id', 'added_by', 'on_behalf_of', 'added_at', 'updated_at']


class MotorNewEntrySerializer(BaseEntrySerializer):
    enforce_one_per_day = False

    agent_name = serializers.SerializerMethodField()
    tat_display = serializers.SerializerMethodField()
    accuracy_pct = serializers.SerializerMethodField()
    allowed_transitions = serializers.SerializerMethodField()
    is_terminal = serializers.SerializerMethodField()

    class Meta:
        model = MotorNewEntry
        fields = [
            'id', 'date',
            'client_name', 'agent', 'agent_name', 'chassis_no', 'remarks',
            'status', 'revisions', 'quotes_compared', 'status_changed_at',
            'tat_display', 'accuracy_pct',
            'allowed_transitions', 'is_terminal',
            'added_by', 'added_by_name',
            'on_behalf_of', 'on_behalf_of_name',
            'added_at', 'updated_at', 'is_editable',
        ]
        read_only_fields = [
            'id', 'added_by', 'on_behalf_of',
            'status', 'status_changed_at',
            'tat_display', 'accuracy_pct',
            'allowed_transitions', 'is_terminal',
            'added_at', 'updated_at',
        ]

    def get_agent_name(self, obj):
        return obj.agent.get_full_name()

    def get_tat_display(self, obj):
        return obj.get_tat_display()

    def get_accuracy_pct(self, obj):
        return obj.accuracy_pct

    def get_allowed_transitions(self, obj):
        return MotorNewEntry.get_allowed_transitions(obj.status)

    def get_is_terminal(self, obj):
        return obj.is_terminal


class MotorNewStatusUpdateSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=MotorNewEntry.STATUS_CHOICES)
    revisions = serializers.IntegerField(min_value=0, required=False)

    def validate_status(self, value):
        entry = self.context['entry']
        allowed = MotorNewEntry.get_allowed_transitions(entry.status)
        if value not in allowed:
            current_label = dict(MotorNewEntry.STATUS_CHOICES).get(entry.status)
            allowed_labels = [dict(MotorNewEntry.STATUS_CHOICES).get(s) for s in allowed]
            raise serializers.ValidationError(
                f"Cannot transition from '{current_label}' to "
                f"'{dict(MotorNewEntry.STATUS_CHOICES).get(value)}'. "
                f"Allowed: {allowed_labels}"
            )
        return value


class MotorNewRevisionsUpdateSerializer(serializers.Serializer):
    revisions = serializers.IntegerField(min_value=0)


class MotorRenewalEntrySerializer(BaseEntrySerializer):
    enforce_one_per_day = False

    agent_name = serializers.SerializerMethodField()
    tat_display = serializers.SerializerMethodField()
    accuracy_pct = serializers.SerializerMethodField()
    allowed_transitions = serializers.SerializerMethodField()
    is_terminal = serializers.SerializerMethodField()

    class Meta:
        model = MotorRenewalEntry
        fields = [
            'id', 'date',
            'client_name', 'agent', 'agent_name', 'chassis_no', 'remarks',
            'status', 'revisions', 'quotes_compared', 'status_changed_at',
            'tat_display', 'accuracy_pct',
            'allowed_transitions', 'is_terminal',
            'added_by', 'added_by_name',
            'on_behalf_of', 'on_behalf_of_name',
            'added_at', 'updated_at', 'is_editable',
        ]
        read_only_fields = [
            'id', 'added_by', 'on_behalf_of',
            'status', 'status_changed_at',
            'tat_display', 'accuracy_pct',
            'allowed_transitions', 'is_terminal',
            'added_at', 'updated_at',
        ]

    def get_agent_name(self, obj):
        return obj.agent.get_full_name()

    def get_tat_display(self, obj):
        return obj.get_tat_display()

    def get_accuracy_pct(self, obj):
        return obj.accuracy_pct

    def get_allowed_transitions(self, obj):
        return MotorRenewalEntry.get_allowed_transitions(obj.status)

    def get_is_terminal(self, obj):
        return obj.is_terminal


class MotorRenewalStatusUpdateSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=MotorRenewalEntry.STATUS_CHOICES)
    revisions = serializers.IntegerField(min_value=0, required=False)

    def validate_status(self, value):
        entry = self.context['entry']
        allowed = MotorRenewalEntry.get_allowed_transitions(entry.status)
        if value not in allowed:
            current_label = dict(MotorRenewalEntry.STATUS_CHOICES).get(entry.status)
            allowed_labels = [dict(MotorRenewalEntry.STATUS_CHOICES).get(s) for s in allowed]
            raise serializers.ValidationError(
                f"Cannot transition from '{current_label}' to "
                f"'{dict(MotorRenewalEntry.STATUS_CHOICES).get(value)}'. "
                f"Allowed: {allowed_labels}"
            )
        return value


class MotorRenewalRevisionsUpdateSerializer(serializers.Serializer):
    revisions = serializers.IntegerField(min_value=0)


class MotorClaimEntrySerializer(BaseEntrySerializer):
    enforce_one_per_day = False
    source_name = serializers.SerializerMethodField()
    type_of_accident_name = serializers.CharField(
        source='type_of_accident.name', read_only=True,
    )
    insurance_company_name = serializers.CharField(
        source='insurance_company.name', read_only=True,
    )
    tat_display = serializers.SerializerMethodField()
    allowed_transitions = serializers.SerializerMethodField()
    is_terminal = serializers.SerializerMethodField()

    class Meta:
        model = MotorClaimEntry
        fields = [
            'id', 'date',
            'client_name', 'vehicle_number', 'claim_number',
            'source', 'source_name',
            'type_of_accident', 'type_of_accident_name',
            'insurance_company', 'insurance_company_name',
            'next_call_date', 'garage_name', 'garage_number',
            'status',
            'added_by', 'added_by_name', 'on_behalf_of', 'on_behalf_of_name',
            'added_at', 'updated_at', 'is_editable',
            'tat_display', 'allowed_transitions', 'is_terminal',
        ]
        read_only_fields = ['id', 'added_by', 'on_behalf_of', 'added_at', 'updated_at']

    def get_source_name(self, obj):
        return obj.source.get_full_name() if obj.source_id else None

    def get_tat_display(self, obj):
        return obj.get_tat_display()

    def get_allowed_transitions(self, obj):
        return MotorClaimEntry.get_allowed_transitions(obj.status)

    def get_is_terminal(self, obj):
        return obj.is_terminal


class TypeOfAccidentSerializer(serializers.ModelSerializer):
    class Meta:
        model = TypeOfAccident
        fields = ['id', 'name', 'is_active', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']

    def validate_name(self, value):
        cleaned = (value or '').strip()
        if not cleaned:
            raise serializers.ValidationError("Name cannot be blank.")
        return cleaned


class InsuranceCompanySerializer(serializers.ModelSerializer):
    class Meta:
        model = InsuranceCompany
        fields = ['id', 'name', 'is_active', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']

    def validate_name(self, value):
        cleaned = (value or '').strip()
        if not cleaned:
            raise serializers.ValidationError("Name cannot be blank.")
        return cleaned


class MotorClaimStatusUpdateSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=MotorClaimEntry.STATUS_CHOICES)

    def validate_status(self, value):
        entry = self.context['entry']
        allowed = MotorClaimEntry.get_allowed_transitions(entry.status)
        if value not in allowed:
            current_label = dict(MotorClaimEntry.STATUS_CHOICES).get(entry.status)
            allowed_labels = [dict(MotorClaimEntry.STATUS_CHOICES).get(s) for s in allowed]
            raise serializers.ValidationError(
                f"Cannot transition from '{current_label}' to "
                f"'{dict(MotorClaimEntry.STATUS_CHOICES).get(value)}'. "
                f"Allowed: {allowed_labels}"
            )
        return value


class SalesKPIEntrySerializer(BaseEntrySerializer):
    class Meta:
        model = SalesKPIEntry
        fields = [
            'id', 'date', 'leads_to_ops_team', 'quotes_from_ops_team',
            'quotes_to_client', 'total_conversions', 'new_clients_acquired',
            'existing_clients_closed',
            'gross_booked_premium',
            'added_by', 'added_by_name', 'on_behalf_of', 'on_behalf_of_name', 'added_at', 'updated_at', 'is_editable'
        ]
        read_only_fields = ['id', 'added_by', 'on_behalf_of', 'added_at', 'updated_at']


class SalesMonthlyTargetSerializer(serializers.ModelSerializer):
    class Meta:
        model = SalesMonthlyTarget
        fields = [
            'id', 'user', 'year', 'month', 'calculated_date',
            'premium_target', 'clients_assigned',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'user', 'calculated_date', 'created_at', 'updated_at']

    def validate_premium_target(self, value):
        if value is not None and value <= 0:
            raise serializers.ValidationError("Premium target must be greater than 0.")
        return value

    def validate_clients_assigned(self, value):
        if value is not None and value <= 0:
            raise serializers.ValidationError("Assigned clients must be greater than 0.")
        return value


class MotorRenewalMonthlyTargetSerializer(serializers.ModelSerializer):
    class Meta:
        model = MotorRenewalMonthlyTarget
        fields = [
            'id', 'user', 'year', 'month', 'calculated_date',
            'clients_assigned',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'user', 'calculated_date', 'created_at', 'updated_at']

    def validate_clients_assigned(self, value):
        if value is not None and value <= 0:
            raise serializers.ValidationError("Assigned clients must be greater than 0.")
        return value


class MarineNewEntrySerializer(BaseEntrySerializer):
    class Meta:
        model = MarineNewEntry
        fields = [
            'id', 'date', 'gross_booked_premium', 'quotes_created',
            'new_clients_acquired', 'new_policies_issued',
            'added_by', 'added_by_name', 'on_behalf_of', 'on_behalf_of_name', 'added_at', 'updated_at', 'is_editable'
        ]
        read_only_fields = ['id', 'added_by', 'on_behalf_of', 'added_at', 'updated_at']


class MarineRenewalEntrySerializer(BaseEntrySerializer):
    class Meta:
        model = MarineRenewalEntry
        fields = [
            'id', 'date', 'monthly_renewal_quotes_assigned', 'gross_booked_premium',
            'quotes_created', 'renewal_policies_issued',
            'added_by', 'added_by_name', 'on_behalf_of', 'on_behalf_of_name', 'added_at', 'updated_at', 'is_editable'
        ]
        read_only_fields = ['id', 'added_by', 'on_behalf_of', 'added_at', 'updated_at']


class MedicalClaimEntrySerializer(BaseEntrySerializer):
    enforce_one_per_day = False
    tat_display = serializers.SerializerMethodField()
    allowed_transitions = serializers.SerializerMethodField()
    is_terminal = serializers.SerializerMethodField()

    class Meta:
        model = MedicalClaimEntry
        fields = [
            'id', 'date', 'customer_name', 'status',
            'added_by', 'added_by_name', 'on_behalf_of', 'on_behalf_of_name', 'added_at', 'updated_at', 'is_editable',
            'tat_display', 'allowed_transitions', 'is_terminal'
        ]
        read_only_fields = ['id', 'added_by', 'on_behalf_of', 'added_at', 'updated_at']

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
