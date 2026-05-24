'use client';

/**
 * Shared status-transition confirmation modal (TED-440).
 *
 * Used by motor_new, motor_renewal, motor_fleet_new, motor_fleet_renewal,
 * general_new, general_renewal — every per-enquiry module where a status
 * change closes the ticket. The caller passes:
 *   - `entry` (only revisions + converted_premium are read)
 *   - `newStatus` + `newStatusLabel` for the body copy
 *   - `needsConvertedPremium`: true for the success transition
 *     (Converted/Retained), false for Lost
 *   - `onConfirm({ revisions, converted_premium })`: invoked on save
 *
 * Visual variants per the Linear ticket screenshots:
 *   - revisions === 0  + needsConvertedPremium:  "Confirm enquiry details"
 *     with Yes/No radio + conditional revision count + Converted Premium AED.
 *   - revisions  >  0  + needsConvertedPremium:  "Confirm Before Closing"
 *     with revision count badge (with Edit toggle) + Converted Premium AED.
 *   - revisions === 0  + Lost transition:        ask Yes/No, optionally
 *     collect a count, then save (no premium prompt).
 *   - revisions  >  0  + Lost transition:        verify-only, no premium.
 */

import { useState } from 'react';
import { AlertTriangle, Pencil } from 'lucide-react';

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

export interface EnquiryStatusModalEntry {
  revisions: number;
  converted_premium?: string | null;
}

export interface EnquiryStatusModalProps {
  entry: EnquiryStatusModalEntry;
  newStatus: string;
  newStatusLabel: string;
  /** True when transitioning to the success state (Converted / Retained). */
  needsConvertedPremium: boolean;
  onCancel: () => void;
  onConfirm: (payload: { revisions?: number; converted_premium?: string }) => void;
}

export function EnquiryStatusModal({
  entry,
  newStatus,
  newStatusLabel,
  needsConvertedPremium,
  onCancel,
  onConfirm,
}: EnquiryStatusModalProps) {
  void newStatus;

  const hasExistingRevisions = entry.revisions > 0;

  // Lost flow keeps the original 2-stage ask → enter → verify (no premium).
  // Success flow is a single dialog with conditional revision input + premium.
  type Stage = 'success-zero' | 'success-recorded' | 'lost-ask' | 'lost-enter' | 'lost-verify';
  const initialStage: Stage = needsConvertedPremium
    ? hasExistingRevisions
      ? 'success-recorded'
      : 'success-zero'
    : hasExistingRevisions
      ? 'lost-verify'
      : 'lost-ask';
  const [stage, setStage] = useState<Stage>(initialStage);

  // Success-zero state: did the user make revisions?
  const [didRevise, setDidRevise] = useState<'yes' | 'no'>('no');
  const [enteredCount, setEnteredCount] = useState(0);
  const [premium, setPremium] = useState(
    entry.converted_premium != null ? String(entry.converted_premium) : '',
  );

  // Success-recorded state: optional inline edit of the recorded count.
  const [isEditingCount, setIsEditingCount] = useState(false);
  const [editedCount, setEditedCount] = useState(entry.revisions);

  const premiumValid = premium.trim() !== '' && Number(premium) > 0;

  const handleSuccessZeroSave = () => {
    if (!premiumValid) return;
    const revisions = didRevise === 'yes' ? Math.max(0, enteredCount) : 0;
    onConfirm({ revisions, converted_premium: premium.trim() });
  };

  const handleSuccessRecordedSave = () => {
    if (!premiumValid) return;
    const revisions = isEditingCount ? Math.max(0, editedCount) : entry.revisions;
    onConfirm({ revisions, converted_premium: premium.trim() });
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="p-0">
        {/* ── SUCCESS, revisions = 0 (UI 1, States 1+2 from the ticket) ─── */}
        {stage === 'success-zero' && (
          <>
            <DialogHeader className="border-b border-[#E4E4E4] p-4">
              <DialogTitle>Confirm enquiry details</DialogTitle>
              <p className="text-sm text-muted-foreground">
                Provide revision and conversion details before closing this enquiry.
              </p>
            </DialogHeader>
            <div className="p-4 space-y-4">
              <div className="bg-[#F3F4F6] rounded-md px-4 py-2 text-center text-sm text-[#374151]">
                This action cannot be reversed.
              </div>

              <div className="space-y-3">
                <Label className="text-sm font-semibold text-[#09090B]">
                  Did you make any revisions for this enquiry?
                </Label>
                <div className="flex items-center gap-6">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="did-revise"
                      checked={didRevise === 'no'}
                      onChange={() => setDidRevise('no')}
                      className="h-4 w-4 accent-[#09090B]"
                    />
                    <span className="text-sm">No</span>
                  </label>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="did-revise"
                      checked={didRevise === 'yes'}
                      onChange={() => setDidRevise('yes')}
                      className="h-4 w-4 accent-[#09090B]"
                    />
                    <span className="text-sm">Yes</span>
                  </label>
                </div>
              </div>

              {didRevise === 'yes' && (
                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-[#09090B]">
                    Number of revisions
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    value={enteredCount}
                    onChange={(e) =>
                      setEnteredCount(Math.max(0, Number(e.target.value || 0)))
                    }
                    autoFocus
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label className="text-sm font-semibold text-[#09090B]">
                  Converted premium
                </Label>
                <div className="flex items-center border border-[#E4E4E4] rounded-md overflow-hidden focus-within:ring-1 focus-within:ring-[#09090B]">
                  <span className="px-3 py-2 text-sm text-[#71717A] bg-[#F9FAFB] border-r border-[#E4E4E4]">
                    AED
                  </span>
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    placeholder="0.00"
                    value={premium}
                    onChange={(e) => setPremium(e.target.value)}
                    className="border-0 shadow-none focus-visible:ring-0"
                    autoFocus={didRevise === 'no'}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Enter the premium amount converted in this enquiry.
                </p>
              </div>
            </div>
            <DialogFooter className="p-4 border-t border-[#E4E4E4]">
              <Button type="button" variant="outline" onClick={onCancel}>
                Cancel
              </Button>
              <Button type="button" onClick={handleSuccessZeroSave} disabled={!premiumValid}>
                Confirm &amp; Save
              </Button>
            </DialogFooter>
          </>
        )}

        {/* ── SUCCESS, revisions > 0 (UI 2, States 1+2 from the ticket) ── */}
        {stage === 'success-recorded' && (
          <>
            <DialogHeader className="border-b border-[#E4E4E4] p-4">
              <DialogTitle>Confirm Before Closing</DialogTitle>
            </DialogHeader>
            <div className="p-4 space-y-4">
              <div className="bg-[#F3F4F6] rounded-md px-4 py-2 text-center text-sm text-[#374151]">
                This action cannot be reversed.
              </div>

              <p className="text-sm text-[#09090B]">
                You are marking this enquiry as <strong>{newStatusLabel}</strong>.
              </p>

              <div className="border border-[#E4E4E4] rounded-lg p-4 flex items-center justify-between gap-3">
                <span className="text-sm text-[#71717A]">Revision count recorded</span>
                {isEditingCount ? (
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={0}
                      value={editedCount}
                      onChange={(e) =>
                        setEditedCount(Math.max(0, Number(e.target.value || 0)))
                      }
                      className="w-20 h-8"
                      autoFocus
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setIsEditingCount(false)}
                    >
                      Done
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <span className="text-2xl font-bold text-[#09090B]">
                      {editedCount}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setIsEditingCount(true)}
                    >
                      <Pencil className="h-3 w-3 mr-1" /> Edit
                    </Button>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-semibold text-[#09090B]">
                  Converted premium
                </Label>
                <div className="flex items-center border border-[#E4E4E4] rounded-md overflow-hidden focus-within:ring-1 focus-within:ring-[#09090B]">
                  <span className="px-3 py-2 text-sm text-[#71717A] bg-[#F9FAFB] border-r border-[#E4E4E4]">
                    AED
                  </span>
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    placeholder="0.00"
                    value={premium}
                    onChange={(e) => setPremium(e.target.value)}
                    className="border-0 shadow-none focus-visible:ring-0"
                    autoFocus
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Please verify this count is correct before saving.
                </p>
              </div>
            </div>
            <DialogFooter className="p-4 border-t border-[#E4E4E4]">
              <Button type="button" variant="outline" onClick={onCancel}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleSuccessRecordedSave}
                disabled={!premiumValid}
              >
                Confirm &amp; Save
              </Button>
            </DialogFooter>
          </>
        )}

        {/* ── LOST, revisions = 0 (original ask → enter flow, no premium) ── */}
        {stage === 'lost-ask' && (
          <>
            <DialogHeader className="border-b border-[#E4E4E4] p-4">
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-[#F59E0B]" />
                Confirm Before Closing
              </DialogTitle>
            </DialogHeader>
            <div className="p-5 space-y-4">
              <p className="text-sm text-[#374151]">
                Before closing as <strong>{newStatusLabel}</strong> — did you make any
                revisions for this enquiry?
              </p>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => onConfirm({ revisions: 0 })}>
                  No, proceed
                </Button>
                <Button type="button" onClick={() => setStage('lost-enter')}>
                  Yes, enter count
                </Button>
              </DialogFooter>
            </div>
          </>
        )}

        {stage === 'lost-enter' && (
          <>
            <DialogHeader className="border-b border-[#E4E4E4] p-4">
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-[#F59E0B]" />
                Confirm Before Closing
              </DialogTitle>
            </DialogHeader>
            <div className="p-5 space-y-4">
              <p className="text-sm text-[#374151]">
                How many revisions were made for this enquiry?
              </p>
              <Input
                type="number"
                min={0}
                value={enteredCount}
                onChange={(e) => setEnteredCount(Math.max(0, Number(e.target.value || 0)))}
                autoFocus
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setStage('lost-ask')}>
                  Back
                </Button>
                <Button type="button" onClick={() => onConfirm({ revisions: enteredCount })}>
                  Confirm &amp; Save
                </Button>
              </DialogFooter>
            </div>
          </>
        )}

        {stage === 'lost-verify' && (
          <>
            <DialogHeader className="border-b border-[#E4E4E4] p-4">
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-[#F59E0B]" />
                Confirm Before Closing
              </DialogTitle>
            </DialogHeader>
            <div className="p-5 space-y-4">
              <p className="text-sm text-[#374151]">
                You are marking this enquiry as <strong>{newStatusLabel}</strong>.
              </p>
              <div className="border border-[#E4E4E4] rounded-lg p-4 flex items-center justify-between">
                <span className="text-sm text-[#71717A]">Revision count recorded</span>
                <span className="text-2xl font-bold text-[#09090B]">{entry.revisions}</span>
              </div>
              <p className="text-xs text-[#71717A]">
                Please verify this count is correct before saving.
              </p>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel}>
                  Cancel
                </Button>
                <Button type="button" onClick={() => onConfirm({ revisions: entry.revisions })}>
                  Confirm &amp; Save
                </Button>
              </DialogFooter>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
