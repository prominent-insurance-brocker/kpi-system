"""Single source of truth mapping audited models -> audit category.

Each category surfaces as one link under the admin-only Audit sidebar section.
The 11 entry modules map 1:1 to their RoleModulePermission module key (reusing
those labels, so e.g. ``sales_kpi`` shows as "Deals"); three grouped categories
cover monthly targets, comments, and the RBAC/user models.
"""
from auth_app.models import CustomUser
from entries.models import (
    EntryRemark,
    GeneralNewEntry,
    GeneralRenewalEntry,
    GeneralRenewalMonthlyTarget,
    MarineNewEntry,
    MarineRenewalEntry,
    MedicalClaimEntry,
    MotorClaimEntry,
    MotorFleetNewEntry,
    MotorFleetRenewalEntry,
    MotorFleetRenewalMonthlyTarget,
    MotorNewEntry,
    MotorRenewalEntry,
    MotorRenewalMonthlyTarget,
    SalesKPIEntry,
    SalesMonthlyTarget,
)
from roles.models import Role, RoleModulePermission

# Grouped (non-module) category keys.
CATEGORY_MONTHLY_TARGETS = 'monthly_targets'
CATEGORY_REMARKS = 'remarks'
CATEGORY_SECURITY = 'security'

# Audited model -> category key. Signals are connected for exactly these models.
MODEL_TO_CATEGORY = {
    GeneralNewEntry: 'general_new',
    GeneralRenewalEntry: 'general_renewal',
    MotorNewEntry: 'motor_new',
    MotorRenewalEntry: 'motor_renewal',
    MotorFleetNewEntry: 'motor_fleet_new',
    MotorFleetRenewalEntry: 'motor_fleet_renewal',
    MotorClaimEntry: 'motor_claim',
    SalesKPIEntry: 'sales_kpi',
    MarineNewEntry: 'marine_new',
    MarineRenewalEntry: 'marine_renewal',
    MedicalClaimEntry: 'medical_claim',
    GeneralRenewalMonthlyTarget: CATEGORY_MONTHLY_TARGETS,
    MotorRenewalMonthlyTarget: CATEGORY_MONTHLY_TARGETS,
    MotorFleetRenewalMonthlyTarget: CATEGORY_MONTHLY_TARGETS,
    SalesMonthlyTarget: CATEGORY_MONTHLY_TARGETS,
    EntryRemark: CATEGORY_REMARKS,
    CustomUser: CATEGORY_SECURITY,
    Role: CATEGORY_SECURITY,
    RoleModulePermission: CATEGORY_SECURITY,
}

# Category display order for the sidebar / API (entry modules first).
CATEGORY_ORDER = [
    'general_new',
    'general_renewal',
    'motor_new',
    'motor_renewal',
    'motor_fleet_new',
    'motor_fleet_renewal',
    'motor_claim',
    'sales_kpi',
    'marine_new',
    'marine_renewal',
    'medical_claim',
    CATEGORY_MONTHLY_TARGETS,
    CATEGORY_REMARKS,
    CATEGORY_SECURITY,
]

# Labels: entry-module categories reuse the canonical RBAC labels so they stay
# in sync with the rest of the app; grouped categories define their own.
_MODULE_LABELS = dict(RoleModulePermission.MODULE_CHOICES)
CATEGORY_LABELS = {key: _MODULE_LABELS.get(key, key) for key in CATEGORY_ORDER}
CATEGORY_LABELS[CATEGORY_MONTHLY_TARGETS] = 'Monthly Targets'
CATEGORY_LABELS[CATEGORY_REMARKS] = 'Comments'
CATEGORY_LABELS[CATEGORY_SECURITY] = 'Users & Roles'

# Per-model fields to drop from diffs, on top of the global ignore list in
# ``audit.signals`` (auth bookkeeping / unused credential fields).
PER_MODEL_IGNORED_FIELDS = {
    CustomUser: {'last_login', 'password'},
}
