/**
 * Format a date string (YYYY-MM-DD) to human readable format
 * Example: "2026-01-25" -> "Jan 25, 2026"
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
 * Format a datetime string to human readable format with time
 * Example: "2026-01-25T21:22:54" -> "Jan 25, 2026 9:22 PM"
 */
export function formatDateTime(dateStr: string): string {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

/**
 * Compact DD/MM/YYYY HH:MM AM/PM. Used in the comments panel where the
 * timestamp sits on its own line and needs to be unambiguous at a glance.
 * Example: "2026-05-15T10:51:00Z" -> "15/05/2026 10:51 AM"
 */
export function formatDateTimeShort(dateStr: string): string {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  const dd = String(date.getDate()).padStart(2, '0')
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const yyyy = date.getFullYear()
  let h = date.getHours()
  const min = String(date.getMinutes()).padStart(2, '0')
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12
  if (h === 0) h = 12
  return `${dd}/${mm}/${yyyy} ${String(h).padStart(2, '0')}:${min} ${ampm}`
}
