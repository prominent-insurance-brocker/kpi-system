'use client';

/**
 * TED-594 — the "Void" pill shown in a module's Status column once an entry is
 * voided. Hovering reveals the reason (and who voided it), which is the
 * universal way to see the void reason — including on the 3 modules (Marine,
 * Medical Claim) that have no comments panel to carry the "Void Reason" tag.
 */

import { Tooltip } from '@/app/components/DataTable';

export function VoidStatusBadge({
  reason,
  voidedByName,
}: {
  reason?: string | null;
  voidedByName?: string | null;
}) {
  const detail = [reason, voidedByName ? `by ${voidedByName}` : '']
    .filter(Boolean)
    .join(' · ');
  return (
    <Tooltip text={detail ? `Void — ${detail}` : 'Void'}>
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-200 text-gray-700 cursor-help">
        Void
      </span>
    </Tooltip>
  );
}
