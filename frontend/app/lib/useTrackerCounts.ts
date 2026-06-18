'use client';

import { useEffect, useState } from 'react';
import { getTrackerCounts } from './api';

/** Per-day, per-user entry counts: dateStr (YYYY-MM-DD) -> userId -> count. */
export type DailyCountMap = Map<string, Map<number, number>>;

interface UseTrackerCountsParams {
  moduleKey: string;
  /** Calendar year of the month to load. */
  year: number;
  /** Calendar month, 0-indexed (JS convention). */
  month: number;
  /** Restrict to these member ids; omit / empty => all visible members. */
  userIds?: number[];
  /** Bump after a create/edit/delete to force a refetch. */
  refreshKey?: number;
  /** Skip the request when the tracker isn't visible. */
  enabled?: boolean;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Daily Tracker counts for one module + month, fetched from the backend
 * aggregation endpoint (`/api/entries/tracker-counts/`). Replaces the old
 * client-side bucketing of a `page_size`-capped entry array: counting happens
 * server-side (no cap) and is bucketed in the business timezone, so the
 * calendar always agrees with the .xlsx export.
 *
 * Returns a `Map<dateStr, Map<userId, count>>`; look up
 * `counts.get(ds)?.get(userId) ?? 0` per cell.
 */
export function useTrackerCounts({
  moduleKey,
  year,
  month,
  userIds,
  refreshKey = 0,
  enabled = true,
}: UseTrackerCountsParams): DailyCountMap {
  const [counts, setCounts] = useState<DailyCountMap>(() => new Map());
  // Collapse the array dependency to a stable primitive for the effect deps.
  const userIdsKey = (userIds ?? []).join(',');

  useEffect(() => {
    if (!enabled) {
      setCounts(new Map());
      return;
    }
    let cancelled = false;

    const start = `${year}-${pad(month + 1)}-01`;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const end = `${year}-${pad(month + 1)}-${pad(lastDay)}`;
    const ids = userIdsKey ? userIdsKey.split(',').map(Number) : undefined;

    getTrackerCounts({ module: moduleKey, start, end, userIds: ids }).then((res) => {
      if (cancelled) return;
      const map: DailyCountMap = new Map();
      for (const row of res.data?.counts ?? []) {
        let inner = map.get(row.date);
        if (!inner) {
          inner = new Map();
          map.set(row.date, inner);
        }
        inner.set(row.user_id, row.count);
      }
      setCounts(map);
    });

    return () => {
      cancelled = true;
    };
  }, [moduleKey, year, month, userIdsKey, refreshKey, enabled]);

  return counts;
}
