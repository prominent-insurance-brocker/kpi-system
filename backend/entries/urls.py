from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    GeneralNewEntryViewSet,
    GeneralRenewalEntryViewSet,
    MotorNewEntryViewSet,
    MotorRenewalEntryViewSet,
    MotorClaimEntryViewSet,
    SalesKPIEntryViewSet,
    SalesMonthlyTargetViewSet,
    MarineNewEntryViewSet,
    MarineRenewalEntryViewSet,
    MedicalClaimEntryViewSet,
)

router = DefaultRouter()
router.register(r'general-new', GeneralNewEntryViewSet, basename='general-new')
router.register(r'general-renewal', GeneralRenewalEntryViewSet, basename='general-renewal')
router.register(r'motor-new', MotorNewEntryViewSet, basename='motor-new')
router.register(r'motor-renewal', MotorRenewalEntryViewSet, basename='motor-renewal')
router.register(r'motor-claim', MotorClaimEntryViewSet, basename='motor-claim')
router.register(r'sales-kpi/monthly-targets', SalesMonthlyTargetViewSet, basename='sales-monthly-targets')
router.register(r'sales-kpi', SalesKPIEntryViewSet, basename='sales-kpi')
router.register(r'marine-new', MarineNewEntryViewSet, basename='marine-new')
router.register(r'marine-renewal', MarineRenewalEntryViewSet, basename='marine-renewal')
router.register(r'medical-claim', MedicalClaimEntryViewSet, basename='medical-claim')

urlpatterns = [
    path('', include(router.urls)),
]
