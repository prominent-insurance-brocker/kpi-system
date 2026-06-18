from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    EntryRemarkViewSet,
    GeneralNewEntryViewSet,
    GeneralRenewalEntryViewSet,
    GeneralRenewalMonthlyTargetViewSet,
    MotorNewEntryViewSet,
    MotorRenewalEntryViewSet,
    MotorRenewalMonthlyTargetViewSet,
    MotorFleetNewEntryViewSet,
    MotorFleetRenewalEntryViewSet,
    MotorFleetRenewalMonthlyTargetViewSet,
    MotorClaimEntryViewSet,
    SalesKPIEntryViewSet,
    SalesMonthlyTargetViewSet,
    MarineNewEntryViewSet,
    MarineRenewalEntryViewSet,
    MedicalClaimEntryViewSet,
    TypeOfAccidentViewSet,
    InsuranceCompanyViewSet,
    ClassOfInsuranceViewSet,
    remarks_content_types,
)
from .tracker_export import TrackerExportView
from .tracker_counts import TrackerCountsView

router = DefaultRouter()
router.register(r'general-new', GeneralNewEntryViewSet, basename='general-new')
# Sub-path must be registered BEFORE the parent so DRF resolves it first.
router.register(r'general-renewal/monthly-targets', GeneralRenewalMonthlyTargetViewSet, basename='general-renewal-monthly-targets')
router.register(r'general-renewal', GeneralRenewalEntryViewSet, basename='general-renewal')
router.register(r'motor-new', MotorNewEntryViewSet, basename='motor-new')
# Sub-path must be registered BEFORE the parent so DRF resolves it first.
router.register(r'motor-renewal/monthly-targets', MotorRenewalMonthlyTargetViewSet, basename='motor-renewal-monthly-targets')
router.register(r'motor-renewal', MotorRenewalEntryViewSet, basename='motor-renewal')
router.register(r'motor-fleet-new', MotorFleetNewEntryViewSet, basename='motor-fleet-new')
# Sub-path must be registered BEFORE the parent so DRF resolves it first.
router.register(r'motor-fleet-renewal/monthly-targets', MotorFleetRenewalMonthlyTargetViewSet, basename='motor-fleet-renewal-monthly-targets')
router.register(r'motor-fleet-renewal', MotorFleetRenewalEntryViewSet, basename='motor-fleet-renewal')
router.register(r'motor-claim', MotorClaimEntryViewSet, basename='motor-claim')
router.register(r'sales-kpi/monthly-targets', SalesMonthlyTargetViewSet, basename='sales-monthly-targets')
router.register(r'sales-kpi', SalesKPIEntryViewSet, basename='sales-kpi')
router.register(r'marine-new', MarineNewEntryViewSet, basename='marine-new')
router.register(r'marine-renewal', MarineRenewalEntryViewSet, basename='marine-renewal')
router.register(r'medical-claim', MedicalClaimEntryViewSet, basename='medical-claim')
# Settings lookup tables (managed via the Settings page).
router.register(r'settings/accident-types', TypeOfAccidentViewSet, basename='accident-types')
router.register(r'settings/insurance-companies', InsuranceCompanyViewSet, basename='insurance-companies')
router.register(r'settings/class-of-insurance', ClassOfInsuranceViewSet, basename='class-of-insurance')
# Cross-module per-entry comments. The router-driven /remarks/ resource lives
# at the entries API root; the helper endpoint exposes the {model: ct_id} map.
router.register(r'remarks', EntryRemarkViewSet, basename='remarks')

urlpatterns = [
    path('remarks-content-types/', remarks_content_types, name='remarks-content-types'),
    # TED-554: Team Daily Tracker export (.xlsx).
    path('tracker-export/', TrackerExportView.as_view(), name='tracker-export'),
    # Team Daily Tracker per-(member, day) counts (JSON) — powers the calendar.
    path('tracker-counts/', TrackerCountsView.as_view(), name='tracker-counts'),
    path('', include(router.urls)),
]
