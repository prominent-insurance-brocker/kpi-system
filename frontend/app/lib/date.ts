// Business timezone — the app renders + buckets every timestamp in this zone so
// the UI always matches the backend (settings.TIME_ZONE) regardless of the
// viewer's browser timezone. Datetimes are STORED in UTC; this only affects how
// they're displayed/grouped. Override with NEXT_PUBLIC_TIMEZONE if you relocate.
const BUSINESS_TZ = process.env.NEXT_PUBLIC_TIMEZONE || 'Asia/Dubai'

/**
 * Format a plain calendar date string (YYYY-MM-DD) to human readable format.
 * Example: "2026-01-25" -> "Jan 25, 2026". No timezone conversion (it's a date).
 */
export function formatDate(dateStr: string): string {
  if (!dateStr) return '-'
  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Format a datetime (UTC ISO) as "Mon D, YYYY h:mm AM/PM" in the business zone.
 * Example: "2026-06-11T18:30:00Z" -> "Jun 11, 2026, 10:30 PM" (Asia/Dubai).
 */
export function formatDateTime(dateStr: string): string {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleDateString('en-US', {
    timeZone: BUSINESS_TZ,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

/**
 * Compact "DD/MM/YYYY HH:MM AM/PM" in the business zone. Used in the comments
 * panel where the timestamp needs to be unambiguous at a glance.
 */
export function formatDateTimeShort(dateStr: string): string {
  if (!dateStr) return '-'
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(new Date(dateStr))
  const p: Record<string, string> = {}
  for (const part of parts) p[part.type] = part.value
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute} ${(p.dayPeriod || '').toUpperCase()}`
}

/**
 * YYYY-MM-DD for a timestamp, in the business zone. Use this to bucket instants
 * (e.g. grouping `added_at` in the Daily Tracker) so they land on the same day
 * the backend filters on — not the viewer's browser-local day.
 */
export function businessDateString(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

/**
 * "Today" in the business zone, as a Date at local midnight of that calendar
 * day. Use instead of `new Date()` so the tracker's today-highlight / past /
 * future reflect the business day, not the viewer's browser day.
 */
export function businessToday(): Date {
  const [y, m, d] = businessDateString(new Date()).split('-').map(Number)
  return new Date(y, m - 1, d)
}
