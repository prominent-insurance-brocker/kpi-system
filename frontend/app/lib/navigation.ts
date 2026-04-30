import type { User } from './api';

const MODULE_ROUTES: Array<[string, string]> = [
  ['general_new', '/general/new'],
  ['general_renewal', '/general/renewal'],
  ['general_claim', '/general/claim'],
  ['motor_new', '/motor/new'],
  ['motor_renewal', '/motor/renewal'],
  ['motor_claim', '/motor/claim'],
  ['sales_kpi', '/sales/kpi'],
  ['marine_new', '/marine/new'],
  ['marine_renewal', '/marine/renewal'],
  ['medical_claim', '/medical/claim'],
];

export function firstAccessibleRoute(user: User | null): string | null {
  if (!user) return null;
  if (user.is_staff) return '/dashboard';
  const allowed = user.role?.module_permissions ?? [];
  for (const [key, route] of MODULE_ROUTES) {
    if (allowed.includes(key)) return route;
  }
  return null;
}
