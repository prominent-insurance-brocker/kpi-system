'use client';

/**
 * Marine New only: "Shared With Client" confirmation modal.
 *
 * Opened when a Marine enquiry is moved to 'shared_with_client'. Lists each of
 * the entry's compared insurers with an optional "Insurer Reference ID" (the
 * quote / reference ID from the insurer's portal), pre-filled from the stored
 * `insurer_references`. Confirm is always enabled; only non-empty values are
 * returned, and the backend replaces the stored map with them (so a re-share
 * can update or clear references). Cancel aborts the status change.
 */

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import type { MotorEnquiryEntry } from '@/app/lib/api';

export interface MarineSharedWithClientModalProps {
  entry: MotorEnquiryEntry;
  onCancel: () => void;
  /** `insurer_references`: str(insurer id) → trimmed reference, non-empty only. */
  onConfirm: (insurerReferences: Record<string, string>) => Promise<void>;
}

export function MarineSharedWithClientModal({
  entry,
  onCancel,
  onConfirm,
}: MarineSharedWithClientModalProps) {
  const insurerIds = entry.compared_insurance_companies ?? [];
  const insurerNames = entry.compared_insurance_companies_names ?? [];
  const [references, setReferences] = useState<Record<string, string>>(() => {
    const stored = entry.insurer_references ?? {};
    return Object.fromEntries(insurerIds.map((id) => [String(id), stored[String(id)] ?? '']));
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleConfirm = async () => {
    if (isSubmitting) return;
    const cleaned: Record<string, string> = {};
    for (const [id, ref] of Object.entries(references)) {
      const trimmed = ref.trim();
      if (trimmed) cleaned[id] = trimmed;
    }
    // Disable Cancel/Confirm until the request settles so a double click
    // cannot send a second (rejected) shared_with_client transition.
    setIsSubmitting(true);
    try {
      await onConfirm(cleaned);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      {/* Clicking outside must not close the form and lose entered data;
          close only via Cancel / X / Esc. */}
      <DialogContent className="p-0" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader className="border-b border-[#E4E4E4] p-4">
          <DialogTitle>Shared With Client</DialogTitle>
        </DialogHeader>

        <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
          <p className="text-sm text-[#71717A]">
            Optionally record the quote / reference ID each insurer issued for{' '}
            {entry.client_name} · {entry.pib_id}.
          </p>

          {insurerIds.length === 0 ? (
            <div className="bg-[#F3F4F6] rounded-md px-4 py-2 text-center text-sm text-[#374151]">
              No compared insurers are recorded on this enquiry.
            </div>
          ) : (
            insurerIds.map((id, idx) => {
              const key = String(id);
              const inputId = `insurer-reference-${key}`;
              return (
                <div key={key} className="space-y-2">
                  <Label htmlFor={inputId} className="text-sm font-semibold text-[#09090B]">
                    {insurerNames[idx] ?? `Insurer #${id}`}
                  </Label>
                  <Input
                    id={inputId}
                    placeholder="Quote / reference ID from insurer portal"
                    aria-label={`Insurer Reference ID for ${insurerNames[idx] ?? `insurer #${id}`}`}
                    value={references[key] ?? ''}
                    onChange={(e) =>
                      setReferences((curr) => ({ ...curr, [key]: e.target.value }))
                    }
                    maxLength={100}
                  />
                  <p className="text-xs text-muted-foreground">Insurer Reference ID (optional)</p>
                </div>
              );
            })
          )}
        </div>

        <DialogFooter className="p-4 border-t border-[#E4E4E4]">
          <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Confirm'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
