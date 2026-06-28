from django.contrib import admin

from .models import Report, ReportSendLog


@admin.register(Report)
class ReportAdmin(admin.ModelAdmin):
    list_display = ('id', 'name', 'report_type', 'is_active', 'last_sent_at')
    list_filter = ('report_type', 'is_active')
    search_fields = ('name',)


@admin.register(ReportSendLog)
class ReportSendLogAdmin(admin.ModelAdmin):
    list_display = ('id', 'report', 'week_start', 'status', 'recipient_count', 'sent_at')
    list_filter = ('status', 'week_start')
