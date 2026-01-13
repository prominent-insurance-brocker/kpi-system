from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    GeneralNewEntryViewSet,
    GeneralRenewalEntryViewSet,
    MotorNewEntryViewSet,
    MotorRenewalEntryViewSet,
    MotorClaimEntryViewSet,
)

router = DefaultRouter()
router.register(r'general-new', GeneralNewEntryViewSet, basename='general-new')
router.register(r'general-renewal', GeneralRenewalEntryViewSet, basename='general-renewal')
router.register(r'motor-new', MotorNewEntryViewSet, basename='motor-new')
router.register(r'motor-renewal', MotorRenewalEntryViewSet, basename='motor-renewal')
router.register(r'motor-claim', MotorClaimEntryViewSet, basename='motor-claim')

urlpatterns = [
    path('', include(router.urls)),
]
