#!/bin/sh
# Container entrypoint (TED-579 follow-up): starts the cron daemon alongside
# gunicorn so scheduled jobs (daily magic-links, weekly sales digest dispatcher)
# actually run in deployment — regardless of whether the platform launches this
# image via the Dockerfile CMD or a compose `command:` override.
set -e

# Apply migrations on boot.
python manage.py migrate --noinput

# Cron jobs run with a MINIMAL environment — they do not inherit the container's
# env vars. Export them so the scheduled management commands get DATABASE_URL,
# EMAIL_*, TIME_ZONE, etc. Without this, Django falls back to the sqlite default
# and the cron jobs query the WRONG database (no reports found -> nothing sent).
# On Debian, cron loads /etc/environment into each job's environment via pam_env.
printenv > /etc/environment

# Register CRONJOBS and (re)start the cron daemon. `remove` first keeps it
# idempotent across restarts so jobs aren't double-registered.
python manage.py crontab remove >/dev/null 2>&1 || true
python manage.py crontab add
cron

# Hand off to gunicorn as the foreground/main process.
exec gunicorn --bind 0.0.0.0:8000 \
  --workers 4 --threads 4 --worker-class gthread \
  --timeout 60 --graceful-timeout 30 \
  --access-logfile - --error-logfile - --capture-output --log-level info \
  backend.wsgi:application
