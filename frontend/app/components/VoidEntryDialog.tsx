'use client';

/**
 * TED-594 — Void (write-off) confirmation dialog.
 *
 * Unlike the generic ConfirmDialog, voiding requires a mandatory reason, so
 * this is a dedicated dialog with a required textarea. On confirm it hands the
 * trimmed reason back to the caller, which calls `voidEntry(apiSlug, id, reason)`.
 *
 * Voiding is irreversible; the confirm button stays disabled until a reason is
 * entered.
 */

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export interface VoidEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void | Promise<void>;
  /** Noun used in the placeholder, e.g. "deal", "enquiry", "claim". */
  noun?: string;
  /** Optional entry label shown in the description, e.g. "PIB-42". */
  entryLabel?: string;
  /** Disables the confirm button + textarea while the request is in flight. */
  isSubmitting?: boolean;
}

export function VoidEntryDialog({
  open,
  onOpenChange,
  onConfirm,
  noun = 'deal',
  entryLabel,
  isSubmitting = false,
}: VoidEntryDialogProps) {
  const [reason, setReason] = useState('');

  // Reset the draft each time the dialog opens.
  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  const trimmed = reason.trim();

  const handleConfirm = async () => {
    if (!trimmed || isSubmitting) return;
    await onConfirm(trimmed);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !isSubmitting) onOpenChange(false);
      }}
    >
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>This action cannot be undone. Do you want to proceed?</DialogTitle>
          <DialogDescription>
            {entryLabel ? `${entryLabel} — ` : ''}
            Voided entries are kept for audit but excluded from all reports and dashboards.
          </DialogDescription>
        </DialogHeader>

        <Textarea
          autoFocus
          rows={5}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={isSubmitting}
          placeholder={`Note down the reason as to why you're making this ${noun} void.`}
        />

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!trimmed || isSubmitting}>
            {isSubmitting ? 'Voiding…' : 'Void it'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
