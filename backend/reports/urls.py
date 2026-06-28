from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import AllReportHistoryView, ReportSettingView, ReportViewSet

router = DefaultRouter()
router.register(r'', ReportViewSet, basename='report')

urlpatterns = [
    # These must precede the router so they aren't captured as a report pk.
    path('settings/', ReportSettingView.as_view(), name='report-settings'),
    path('history/', AllReportHistoryView.as_view(), name='report-history-all'),
    path('', include(router.urls)),
]
