"""Schedule resolution for report sending (TED-567).

A report's effective schedule = its own ``send_weekday`` / ``send_time`` when
set, otherwise the global ``ReportSetting`` defaults. The dispatcher command
runs frequently (see CRONJOBS) and uses ``is_due`` to decide which reports to
send; the once-per-week ``ReportSendLog`` guard (keyed on the reporting week)
prevents duplicate sends.
"""
from datetime import datetime, timedelta


def effective_schedule(report, setting):
    """(weekday, time) for a report, falling back per-field to the global default."""
    weekday = (
        report.send_weekday if report.send_weekday is not None
        else setting.default_send_weekday
    )
    send_time = (
        report.send_time if report.send_time is not None
        else setting.default_send_time
    )
    return weekday, send_time


def reporting_week_start(ref_date):
    """Monday of the most recent completed week — same basis as the digest and
    the ReportSendLog idempotency key."""
    this_monday = ref_date - timedelta(days=ref_date.weekday())
    return this_monday - timedelta(days=7)


def scheduled_datetime_this_week(weekday, send_time, now):
    """The configured send moment within the CURRENT week, as an aware dt in
    ``now``'s timezone."""
    this_monday = now.date() - timedelta(days=now.date().weekday())
    scheduled_date = this_monday + timedelta(days=weekday)
    return datetime.combine(scheduled_date, send_time, tzinfo=now.tzinfo)


def is_due(report, setting, now):
    """True once the report's scheduled send moment for the current week has
    passed. (Already-sent-this-week is checked separately via ReportSendLog.)"""
    weekday, send_time = effective_schedule(report, setting)
    return now >= scheduled_datetime_this_week(weekday, send_time, now)
