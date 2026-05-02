from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models
from django.utils import timezone
from datetime import timedelta
import secrets


class CustomUserManager(BaseUserManager):
    def create_user(self, email, password=None, **extra_fields):
        if not email:
            raise ValueError('The Email field must be set')
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault('is_staff', True)
        extra_fields.setdefault('is_superuser', True)

        if extra_fields.get('is_staff') is not True:
            raise ValueError('Superuser must have is_staff=True.')
        if extra_fields.get('is_superuser') is not True:
            raise ValueError('Superuser must have is_superuser=True.')

        return self.create_user(email, password, **extra_fields)


class CustomUser(AbstractBaseUser, PermissionsMixin):
    email = models.EmailField(unique=True)
    full_name = models.CharField(max_length=100, blank=True)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    date_joined = models.DateTimeField(auto_now_add=True)
    role = models.ForeignKey(
        'roles.Role',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='users'
    )

    objects = CustomUserManager()

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = []

    def __str__(self):
        return self.email

    def get_full_name(self):
        return self.full_name or self.email

    def get_short_name(self):
        return self.full_name.split()[0] if self.full_name else self.email.split('@')[0]


class MagicLink(models.Model):
    """Model for passwordless magic link authentication tokens."""
    user = models.ForeignKey(
        CustomUser,
        on_delete=models.CASCADE,
        related_name='magic_links'
    )
    token = models.CharField(max_length=64, unique=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    is_used = models.BooleanField(default=False)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"MagicLink for {self.user.email}"

    @classmethod
    def create_for_user(cls, user, expiry_minutes=30, invalidate_prior=True):
        """Create a new magic link for a user.

        By default, all previous unused tokens for this user are invalidated.
        Pass ``invalidate_prior=False`` for batch flows (e.g. the daily-cron
        emailer) where killing the user's outstanding link would lock them out
        of an already-delivered email they haven't clicked yet.
        """
        if invalidate_prior:
            cls.objects.filter(user=user, is_used=False).update(is_used=True)

        token = secrets.token_urlsafe(48)
        expires_at = timezone.now() + timedelta(minutes=expiry_minutes)
        return cls.objects.create(user=user, token=token, expires_at=expires_at)

    def is_valid(self):
        """Check if the token is still valid (not used and not expired)."""
        return not self.is_used and self.expires_at > timezone.now()
