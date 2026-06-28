from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import ReportSettingView, ReportViewSet

router = DefaultRouter()
router.register(r'', ReportViewSet, basename='report')

urlpatterns = [
    # Must precede the router so '/settings/' isn't captured as a report pk.
    path('settings/', ReportSettingView.as_view(), name='report-settings'),
    path('', include(router.urls)),
]
