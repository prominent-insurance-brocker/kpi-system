"""Email rendering + sending for configured reports (TED-567).

The Sales Weekly Digest is the first HTML email in the system, so it uses
``EmailMultiAlternatives`` (HTML body + plain-text fallback) rather than the
plain ``send_mail`` used by the magic-link flows.
"""
import logging

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string

logger = logging.getLogger(__name__)

SALES_WEEKLY_DIGEST_SUBJECT = 'Sales Weekly Digest - System Generated'


def send_sales_weekly_digest(metrics, recipient, subject=None):
    """Render and send the Sales Weekly Digest to a single recipient.

    ``subject`` overrides the default system-generated subject (per-report
    customisation); a falsy value falls back to ``SALES_WEEKLY_DIGEST_SUBJECT``.
    One email per recipient (no cross-recipient address leakage). Raises on
    send failure so callers can isolate per-recipient errors.
    """
    subject = subject or SALES_WEEKLY_DIGEST_SUBJECT
    context = {'m': metrics, 'subject': subject}
    text_body = render_to_string('reports/sales_weekly_digest.txt', context)
    html_body = render_to_string('reports/sales_weekly_digest.html', context)

    msg = EmailMultiAlternatives(
        subject=subject,
        body=text_body,
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=[recipient],
    )
    msg.attach_alternative(html_body, 'text/html')
    msg.send(fail_silently=False)
    logger.info("Sales Weekly Digest sent to %s", recipient)
