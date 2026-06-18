// Audit categories — each renders one link under the admin-only Audit sidebar
// section and one viewer page at /audit/<key>. Mirrors the backend
// MODEL_TO_CATEGORY / CATEGORY_LABELS in backend/audit/registry.py; keep the
// two in sync when modules change.
export interface AuditCategory {
  key: string;
  label: string;
}

export const AUDIT_CATEGORIES: AuditCategory[] = [
  { key: 'general_new', label: 'General New' },
  { key: 'general_renewal', label: 'General Renewal' },
  { key: 'motor_new', label: 'Motor New' },
  { key: 'motor_renewal', label: 'Motor Renewal' },
  { key: 'motor_fleet_new', label: 'Motor Fleet New' },
  { key: 'motor_fleet_renewal', label: 'Motor Fleet Renewal' },
  { key: 'motor_claim', label: 'Motor Claim' },
  { key: 'sales_kpi', label: 'Deals' },
  { key: 'marine_new', label: 'Marine New' },
  { key: 'marine_renewal', label: 'Marine Renewal' },
  { key: 'medical_claim', label: 'Medical Claim' },
  { key: 'monthly_targets', label: 'Monthly Targets' },
  { key: 'remarks', label: 'Comments' },
  { key: 'security', label: 'Users & Roles' },
];

export function auditCategoryLabel(key: string): string {
  return AUDIT_CATEGORIES.find((c) => c.key === key)?.label ?? key;
}
