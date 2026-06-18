from django.apps import AppConfig


class AuditConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'audit'

    def ready(self):
        # Connect the audit signal handlers once the app registry is ready.
        from . import signals
        signals.connect()
