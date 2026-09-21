/**
 * TED-797: the "Voided" entry in the Enquiries Status filter.
 *
 * Voiding is not a status. `status` is a CharField on the entry
 * (new / in_progress / shared_with_client / converted / retained / lost /
 * rejected) while voiding is the separate boolean `is_voided` (TED-594), and a
 * voided entry keeps whatever status it had when it was written off.
 *
 * The filter dropdown offers Voided alongside the real statuses because that is
 * where users look for it, so the pages carry a sentinel value that is NOT a
 * status and must never be sent as `?status=`. `applyStatusFilter` is the one
 * place that translation happens — use it instead of setting `status` by hand,
 * so the option value and the query param can never drift apart.
 */
import type { FilterBarOption } from '@/app/components/FilterBar';

/** Sentinel held in a page's `statusFilter` state when Voided is selected. */
export const VOIDED_STATUS_FILTER = 'voided';

/** Append to a module's real status options to offer Voided in the dropdown. */
export const VOIDED_FILTER_OPTION: FilterBarOption = {
  value: VOIDED_STATUS_FILTER,
  label: 'Voided',
};

/**
 * Write the Status filter onto an entries-list query string.
 *
 * Voided becomes `?is_voided=true` (every entry list endpoint accepts it —
 * `EntryFilter` in backend/entries/filters.py), which returns voided entries
 * whatever their underlying status. Selecting a real status is left alone and
 * still returns voided entries carrying that status, as it did before TED-797;
 * changing that is TED-798's call. The empty string means "All" and sends
 * neither param.
 */
export function applyStatusFilter(qs: URLSearchParams, statusFilter: string): void {
  if (statusFilter === VOIDED_STATUS_FILTER) {
    qs.set('is_voided', 'true');
  } else if (statusFilter) {
    qs.set('status', statusFilter);
  }
}
