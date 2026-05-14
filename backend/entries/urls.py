from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    GeneralNewEntryViewSet,
    GeneralRenewalEntryViewSet,
    GeneralRenewalMonthlyTargetViewSet,
    MotorNewEntryViewSet,
    MotorRenewalEntryViewSet,
    MotorRenewalMonthlyTargetViewSet,
    MotorClaimEntryViewSet,
    SalesKPIEntryViewSet,
    SalesMonthlyTargetViewSet,
    MarineNewEntryViewSet,
    MarineRenewalEntryViewSet,
    MedicalClaimEntryViewSet,
    TypeOfAccidentViewSet,
    InsuranceCompanyViewSet,
)

router = DefaultRouter()
router.register(r'general-new', GeneralNewEntryViewSet, basename='general-new')
# Sub-path must be registered BEFORE the parent so DRF resolves it first.
router.register(r'general-renewal/monthly-targets', GeneralRenewalMonthlyTargetViewSet, basename='general-renewal-monthly-targets')
router.register(r'general-renewal', GeneralRenewalEntryViewSet, basename='general-renewal')
router.register(r'motor-new', MotorNewEntryViewSet, basename='motor-new')
# Sub-path must be registered BEFORE the parent so DRF resolves it first.
router.register(r'motor-renewal/monthly-targets', MotorRenewalMonthlyTargetViewSet, basename='motor-renewal-monthly-targets')
router.register(r'motor-renewal', MotorRenewalEntryViewSet, basename='motor-renewal')
router.register(r'motor-claim', MotorClaimEntryViewSet, basename='motor-claim')
router.register(r'sales-kpi/monthly-targets', SalesMonthlyTargetViewSet, basename='sales-monthly-targets')
router.register(r'sales-kpi', SalesKPIEntryViewSet, basename='sales-kpi')
router.register(r'marine-new', MarineNewEntryViewSet, basename='marine-new')
router.register(r'marine-renewal', MarineRenewalEntryViewSet, basename='marine-renewal')
router.register(r'medical-claim', MedicalClaimEntryViewSet, basename='medical-claim')
# Settings lookup tables (managed via the Settings page).
router.register(r'settings/accident-types', TypeOfAccidentViewSet, basename='accident-types')
router.register(r'settings/insurance-companies', InsuranceCompanyViewSet, basename='insurance-companies')

urlpatterns = [
    path('', include(router.urls)),
]
