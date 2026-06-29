"""Email rendering + sending for configured reports (TED-567).

The Sales Weekly Digest is the first HTML email in the system, so it uses
``EmailMultiAlternatives`` (HTML body + plain-text fallback) with the brand
logo embedded as an inline CID image (reliable across clients — no external
fetch that gets blocked).
"""
import logging
from email.mime.image import MIMEImage
from pathlib import Path

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string

logger = logging.getLogger(__name__)

SALES_WEEKLY_DIGEST_SUBJECT = 'Sales Weekly Digest - System Generated'

LOGO_PATH = Path(__file__).resolve().parent / 'assets' / 'prominent-logo.png'
LOGO_CID = 'prominent_logo'  # referenced as <img src="cid:prominent_logo"> in the template


def _attach_logo(msg):
    """Embed the brand logo inline so it renders without an external fetch."""
    try:
        with open(LOGO_PATH, 'rb') as fh:
            image = MIMEImage(fh.read())
    except OSError as exc:
        logger.warning("Logo not attached (%s): %s", LOGO_PATH, exc)
        return
    image.add_header('Content-ID', f'<{LOGO_CID}>')
    image.add_header('Content-Disposition', 'inline', filename='prominent-logo.png')
    msg.attach(image)


def send_sales_weekly_digest(metrics, recipient, subject=None):
    """Render and send the Sales Weekly Digest to a single recipient.

    ``subject`` overrides the default system-generated subject (per-report
    customisation); a falsy value falls back to ``SALES_WEEKLY_DIGEST_SUBJECT``.
    One email per recipient (no cross-recipient address leakage). Raises on
    send failure so callers can isolate per-recipient errors.
    """
    subject = subject or SALES_WEEKLY_DIGEST_SUBJECT
    context = {'m': metrics, 'subject': subject, 'logo_cid': LOGO_CID}
    text_body = render_to_string('reports/sales_weekly_digest.txt', context)
    html_body = render_to_string('reports/sales_weekly_digest.html', context)

    msg = EmailMultiAlternatives(
        subject=subject,
        body=text_body,
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=[recipient],
    )
    msg.attach_alternative(html_body, 'text/html')
    # Inline images referenced by cid: must live in a multipart/related part.
    msg.mixed_subtype = 'related'
    _attach_logo(msg)
    msg.send(fail_silently=False)
    logger.info("Sales Weekly Digest sent to %s", recipient)
