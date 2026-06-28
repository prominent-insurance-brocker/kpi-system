from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email
from rest_framework import serializers

from .models import Report, ReportSetting


def _validate_weekday(value):
    if value is not None and not (0 <= value <= 6):
        raise serializers.ValidationError('Weekday must be 0 (Monday) to 6 (Sunday).')
    return value


class ReportSerializer(serializers.ModelSerializer):
    created_by_email = serializers.EmailField(source='created_by.email', read_only=True)
    # Declared explicitly so it is REQUIRED on create (the model default would
    # otherwise let a POST omit it and silently create a report with no
    # recipients). Still optional on PATCH (partial updates skip required fields).
    recipients = serializers.JSONField()

    class Meta:
        model = Report
        fields = [
            'id', 'name', 'subject', 'report_type', 'recipients', 'is_active',
            'send_weekday', 'send_time',
            'last_sent_at', 'created_by_email', 'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'last_sent_at', 'created_by_email', 'created_at', 'updated_at',
        ]

    def validate_name(self, value):
        value = (value or '').strip()
        if not value:
            raise serializers.ValidationError('Name is required.')
        return value

    def validate_send_weekday(self, value):
        return _validate_weekday(value)

    def validate_recipients(self, value):
        """Normalise to a deduped list of valid, lowercased email addresses."""
        if not isinstance(value, list):
            raise serializers.ValidationError(
                'Recipients must be a list of email addresses.'
            )
        cleaned = []
        seen = set()
        invalid = []
        for raw in value:
            if not isinstance(raw, str):
                invalid.append(str(raw))
                continue
            email = raw.strip().lower()
            if not email:
                continue
            try:
                validate_email(email)
            except DjangoValidationError:
                invalid.append(raw)
                continue
            if email not in seen:
                seen.add(email)
                cleaned.append(email)
        if invalid:
            raise serializers.ValidationError(
                f"Invalid email address(es): {', '.join(invalid)}"
            )
        if not cleaned:
            raise serializers.ValidationError(
                'At least one recipient email is required.'
            )
        return cleaned


class ReportSettingSerializer(serializers.ModelSerializer):
    """Global default send schedule (singleton)."""

    class Meta:
        model = ReportSetting
        fields = ['default_send_weekday', 'default_send_time']

    def validate_default_send_weekday(self, value):
        return _validate_weekday(value)
