import type { User } from '@/app/lib/api';

/**
 * Entry-level permission helpers shared across module pages.
 *
 * Admin (is_staff) and HOD (role.is_hod) users are *oversight* roles: they can
 * see everyone's entries, but on entries they did NOT create they are
 * view-only — they cannot change the status or edit/delete the entry. They can
 * still add comments (comment edit/delete is already author-only). Each user
 * retains full control of entries they created themselves.
 */

/** True when the user is an oversight viewer (super-admin or HOD). */
export function isOversightViewer(user: User | null | undefined): boolean {
  return !!user && (user.is_staff || !!user.role?.is_hod);
}

/**
 * Whether `user` may modify the given entry (change status, edit). Oversight
 * viewers may only modify entries they created; everyone else is unaffected
 * here (their edit/delete ownership is still enforced server-side).
 */
export function canModifyEntry(
  user: User | null | undefined,
  addedById: number,
): boolean {
  return !isOversightViewer(user) || user?.id === addedById;
}
