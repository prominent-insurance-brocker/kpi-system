from django.db import models


class Role(models.Model):
    """Role model for RBAC."""
    DATA_VISIBILITY_CHOICES = [
        ('all', 'See all data'),
        ('own', 'See own data only'),
    ]

    name = models.CharField(max_length=100, unique=True)
    description = models.TextField(blank=True)
    data_visibility = models.CharField(
        max_length=10,
        choices=DATA_VISIBILITY_CHOICES,
        default='own'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class RoleModulePermission(models.Model):
    """Module-level permissions for roles."""
    MODULE_CHOICES = [
        ('general_new', 'General New'),
        ('general_renewal', 'General Renewal'),
        ('general_claim', 'General Claim'),
        ('motor_new', 'Motor New'),
        ('motor_renewal', 'Motor Renewal'),
        ('motor_claim', 'Motor Claim'),
        ('sales_premium_data', 'Sales Premium Data'),
        ('sales_kpi', 'Sales KPI'),
        ('marine_new', 'Marine New'),
        ('marine_renewal', 'Marine Renewal'),
        ('medical_claim', 'Medical Claim'),
    ]

    role = models.ForeignKey(
        Role,
        on_delete=models.CASCADE,
        related_name='permissions'
    )
    module = models.CharField(max_length=50, choices=MODULE_CHOICES)

    class Meta:
        unique_together = ['role', 'module']

    def __str__(self):
        return f"{self.role.name} - {self.get_module_display()}"
