import logging

from django.conf import settings
from django.core.mail import send_mail
from django.core.management.base import BaseCommand

from auth_app.models import CustomUser, MagicLink

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = 'Sends daily magic link login emails to all active users'

    def add_arguments(self, parser):
        parser.add_argument(
            '--expiry-hours',
            type=int,
            default=None,
            help='Magic link expiry in hours (default: SCHEDULED_MAGIC_LINK_EXPIRY_HOURS setting)',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Show what would be sent without actually sending emails',
        )

    def handle(self, *args, **options):
        expiry_hours = options['expiry_hours'] or getattr(
            settings, 'SCHEDULED_MAGIC_LINK_EXPIRY_HOURS', 12
        )
        expiry_minutes = expiry_hours * 60
        dry_run = options['dry_run']

        active_users = CustomUser.objects.filter(is_active=True)
        total = active_users.count()

        self.stdout.write(
            f"Sending daily magic links to {total} active users "
            f"(expiry: {expiry_hours}h, dry_run: {dry_run})"
        )

        sent_count = 0
        failed_count = 0
        failed_emails = []

        for user in active_users:
            try:
                magic_link = MagicLink.create_for_user(user, expiry_minutes=expiry_minutes)
                link_url = f"{settings.FRONTEND_URL}/auth/verify?token={magic_link.token}"

                if dry_run:
                    self.stdout.write(f"  [DRY RUN] Would send to {user.email}: {link_url}")
                    sent_count += 1
                    continue

                send_mail(
                    subject='Your daily login link for KPI System',
                    message=f"""Hi {user.get_short_name()},

Here is your login link for KPI System:
{link_url}

This link expires in {expiry_hours} hours.

If you did not expect this email, please ignore it.""",
                    from_email=settings.DEFAULT_FROM_EMAIL,
                    recipient_list=[user.email],
                    fail_silently=False,
                )
                sent_count += 1
                logger.info(f"Daily magic link sent to {user.email}")

            except Exception as e:
                failed_count += 1
                failed_emails.append(user.email)
                logger.error(f"Failed to send daily magic link to {user.email}: {e}")
                self.stderr.write(self.style.ERROR(f"  FAILED: {user.email} - {e}"))

        self.stdout.write(self.style.SUCCESS(f"Done. Sent: {sent_count}, Failed: {failed_count}"))
        if failed_emails:
            self.stdout.write(self.style.WARNING(f"Failed emails: {', '.join(failed_emails)}"))
