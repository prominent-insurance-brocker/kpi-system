'use client';

/**
 * Shared status-transition confirmation modal (TED-440 → TED-530).
 *
 * Used by motor_new, motor_renewal, motor_fleet_new, motor_fleet_renewal,
 * general_new, general_renewal — every per-enquiry module where a status
 * change closes the ticket.
 *
 * TED-530 simplified this to a single, unconditional "Confirm enquiry details"
 * dialog (no more revision-count branching). It always shows the same four
 * fields, pre-filled with the entry's saved values; whatever the user leaves
 * or edits is saved as final:
 *   1. Revision Count        — shown with an Edit toggle
 *   2. No. of Quotes Compared — shown with an Edit toggle
 *   3. Coverage              — a dropdown the caller supplies via `coverage`
 *      (Class of Enquiry → Comprehensive/TPL for Motor; Class of Insurance for
 *      General)
 *   4. Converted Premium     — AED amount; required on the success transition
 *      (Converted/Retained) and optional on Lost, but saved on both.
 *
 * The caller passes:
 *   - `entry` (revisions, quotes_compared, converted_premium are read)
 *   - `needsConvertedPremium`: true for the success transition — gates the
 *     Confirm button on a positive premium; false (Lost) leaves it optional
 *   - `coverage`: how to render + seed the module-specific coverage dropdown
 *   - `onConfirm({ revisions, quotes_compared, coverage, converted_premium })`
 */

import { useState, type ReactNode } from 'react';
import { Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
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
  quotes_compared: number;
  converted_premium?: string | null;
}

export interface EnquiryStatusModalCoverage {
  /** Field label, e.g. "Class of Enquiry" or "Class of Insurance". */
  label: string;
  /** Helper text shown beneath the dropdown. */
  helper: string;
  /** Current value as a string (motor: class_of_enquiry; general: the id). */
  initialValue: string;
  /** Renders the module-specific dropdown wired to the modal's state. */
  renderControl: (value: string, onChange: (v: string) => void) => ReactNode;
}

export interface EnquiryStatusModalProps {
  entry: EnquiryStatusModalEntry;
  /** True on the success transition (Converted / Retained); false on Lost. */
  needsConvertedPremium: boolean;
  coverage: EnquiryStatusModalCoverage;
  onCancel: () => void;
  onConfirm: (payload: {
    revisions: number;
    quotes_compared: number;
    coverage: string;
    converted_premium?: string;
  }) => void;
}

/** A bordered "value + Edit" row that toggles to an inline number input. */
function EditableCountRow({
  recordedLabel,
  value,
  isEditing,
  onEdit,
  onDone,
  onChange,
}: {
  recordedLabel: string;
  value: number;
  isEditing: boolean;
  onEdit: () => void;
  onDone: () => void;
  onChange: (v: number) => void;
}) {
  return (
    <div className="border border-[#E4E4E4] rounded-lg p-4 flex items-center justify-between gap-3">
      <span className="text-sm text-[#71717A]">{recordedLabel}</span>
      {isEditing ? (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={0}
            value={value}
            onChange={(e) => onChange(Math.max(0, Number(e.target.value || 0)))}
            className="w-20 h-8"
            autoFocus
          />
          <Button type="button" size="sm" variant="outline" onClick={onDone}>
            Done
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <span className="text-2xl font-bold text-[#09090B]">{value}</span>
          <Button type="button" size="sm" variant="outline" onClick={onEdit}>
            <Pencil className="h-3 w-3 mr-1" /> Edit
          </Button>
        </div>
      )}
    </div>
  );
}

export function EnquiryStatusModal({
  entry,
  needsConvertedPremium,
  coverage,
  onCancel,
  onConfirm,
}: EnquiryStatusModalProps) {
  const [editedRevisions, setEditedRevisions] = useState(entry.revisions);
  const [isEditingRevisions, setIsEditingRevisions] = useState(false);
  const [editedQuotes, setEditedQuotes] = useState(entry.quotes_compared);
  const [isEditingQuotes, setIsEditingQuotes] = useState(false);
  const [coverageValue, setCoverageValue] = useState(coverage.initialValue);
  const [premium, setPremium] = useState(
    entry.converted_premium != null ? String(entry.converted_premium) : '',
  );

  const premiumValid = premium.trim() !== '' && Number(premium) > 0;
  const canSave = !needsConvertedPremium || premiumValid;

  const handleSave = () => {
    if (!canSave) return;
    onConfirm({
      revisions: Math.max(0, editedRevisions),
      quotes_compared: Math.max(0, editedQuotes),
      coverage: coverageValue,
      converted_premium: premium.trim() || undefined,
    });
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="p-0">
        <DialogHeader className="border-b border-[#E4E4E4] p-4">
          <DialogTitle>Confirm enquiry details</DialogTitle>
        </DialogHeader>

        <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="bg-[#F3F4F6] rounded-md px-4 py-2 text-center text-sm text-[#374151]">
            This action cannot be reversed.
          </div>

          {/* 1. Revision count */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold text-[#09090B]">
              How many revisions were made for this enquiry?
            </Label>
            <EditableCountRow
              recordedLabel="Revision Count Recorded"
              value={editedRevisions}
              isEditing={isEditingRevisions}
              onEdit={() => setIsEditingRevisions(true)}
              onDone={() => setIsEditingRevisions(false)}
              onChange={setEditedRevisions}
            />
            <p className="text-xs text-muted-foreground">
              Verify that the Revision Count is correct. Update it if needed
            </p>
          </div>

          {/* 2. Quotes compared */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold text-[#09090B]">
              How many quotations have been compared?
            </Label>
            <EditableCountRow
              recordedLabel="No. of Quotes Compared Recorded"
              value={editedQuotes}
              isEditing={isEditingQuotes}
              onEdit={() => setIsEditingQuotes(true)}
              onDone={() => setIsEditingQuotes(false)}
              onChange={setEditedQuotes}
            />
            <p className="text-xs text-muted-foreground">
              Verify that the Number of Quotes Compared are correct. update them if needed
            </p>
          </div>

          {/* 3. Coverage (Class of Enquiry / Class of Insurance) */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold text-[#09090B]">
              {coverage.label}
            </Label>
            {coverage.renderControl(coverageValue, setCoverageValue)}
            <p className="text-xs text-muted-foreground">{coverage.helper}</p>
          </div>

          {/* 4. Converted premium */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold text-[#09090B]">
              Converted premium
            </Label>
            <div className="flex items-center border border-[#E4E4E4] rounded-md overflow-hidden focus-within:ring-1 focus-within:ring-[#09090B]">
              <span className="px-3 py-2 text-sm text-[#71717A] bg-[#F9FAFB] border-r border-[#E4E4E4]">
                AED
              </span>
              <NumberInput
                placeholder="0.00"
                value={premium}
                onValueChange={setPremium}
                className="border-0 shadow-none focus-visible:ring-0"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Enter the converted premium amount for this enquiry.
            </p>
          </div>
        </div>

        <DialogFooter className="p-4 border-t border-[#E4E4E4]">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={!canSave}>
            Confirm &amp; Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
