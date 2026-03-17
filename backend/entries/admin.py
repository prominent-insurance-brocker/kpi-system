from django.contrib import admin
from .models import (
    GeneralNewEntry, GeneralRenewalEntry,
    MotorNewEntry, MotorRenewalEntry, MotorClaimEntry,
    MedicalClaimEntry,
)

class BaseEntryAdmin(admin.ModelAdmin):
    list_display = ('date', 'added_by', 'added_at')
    list_filter = ('date', 'added_by', 'added_at')
    search_fields = ('added_by__email',)
    readonly_fields = ('added_at', 'updated_at')

@admin.register(GeneralNewEntry)
class GeneralNewEntryAdmin(BaseEntryAdmin):
    list_display = BaseEntryAdmin.list_display + ('quotations', 'quotes_converted', 'accuracy')

@admin.register(GeneralRenewalEntry)
class GeneralRenewalEntryAdmin(BaseEntryAdmin):
    list_display = BaseEntryAdmin.list_display + ('quotations', 'quotes_converted', 'accuracy')

@admin.register(MotorNewEntry)
class MotorNewEntryAdmin(BaseEntryAdmin):
    list_display = BaseEntryAdmin.list_display + ('quotations', 'quotes_revised', 'accuracy')

@admin.register(MotorRenewalEntry)
class MotorRenewalEntryAdmin(BaseEntryAdmin):
    list_display = BaseEntryAdmin.list_display + ('quotations', 'retention', 'accuracy')

@admin.register(MotorClaimEntry)
class MotorClaimEntryAdmin(BaseEntryAdmin):
    list_display = BaseEntryAdmin.list_display + ('customer_name', 'status')

@admin.register(MedicalClaimEntry)
class MedicalClaimEntryAdmin(BaseEntryAdmin):
    list_display = BaseEntryAdmin.list_display + ('customer_name', 'status')
