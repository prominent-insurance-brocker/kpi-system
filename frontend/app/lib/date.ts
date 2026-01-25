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
