/**
 * Turnaround-time (TAT) formatting.
 *
 * The backend renders each row's TAT via get_tat_display() (backend
 * entries/models.py) as a compound, magnitude-dependent string:
 *   >= 1 day  -> "2d 3h 30m"
 *   >= 1 hour -> "5h 15m"
 *   >= 1 min  -> "45m 30s"
 *   <  1 min  -> "12s"
 *
 * The "Avg. TAT" stat card receives the average as a number of MINUTES
 * (avg_tat_minutes) and must render it in the SAME format as the rows, so the
 * card and the table read consistently (TED-525) rather than a lossy single
 * decimal unit like "2.1d". Keep this in sync with the backend
 * get_tat_display() format.
 */
export function formatTatFromMinutes(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return '—';
  const totalSeconds = Math.round(minutes * 60);
  if (totalSeconds < 0) return '—';
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m ${seconds}s`;
  return `${seconds}s`;
}
