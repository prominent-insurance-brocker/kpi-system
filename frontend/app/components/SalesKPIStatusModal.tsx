'use client';

/**
 * TED-447 / TED-533 status transition modal for Sales KPI tickets.
 *
 * Opened only for the two terminal transitions (Won / Lost) — moves among the
 * non-terminal stages (Lead / Awaiting Quote / Shared with Client) are applied
 * inline on the page with no popup. Both terminal moves are irreversible, so
 * the warning banner stays.
 *
 *  - Won:  asks ONLY for Converted Premium (required, > 0). The three workflow
 *          answers are forced to Yes by the backend, so they aren't shown.
 *  - Lost: asks the three Yes/No workflow questions only (TED-538: the Converted
 *          Premium field is hidden — a lost deal has no converted premium).
 *
 * The backend serializer validates the same constraints — keep the gates in
 * sync if you add a transition variant.
 */

import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { NumberInput } from '@/components/ui/number-input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  updateSalesKPIStatus,
  type SalesKPIEntry,
  type SalesKPIStatus,
  type SalesKPIStatusUpdatePayload,
} from '@/app/lib/api';

type WorkflowAnswer = 'yes' | 'no' | null;

interface YesNoRowProps {
  label: string;
  value: WorkflowAnswer;
  onChange: (val: 'yes' | 'no') => void;
}

function YesNoRow({ label, value, onChange }: YesNoRowProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Label className="text-sm font-normal text-[#09090B]">{label}</Label>
      <div className="inline-flex rounded-md border border-[#E4E4E4] overflow-hidden">
        <button
          type="button"
          onClick={() => onChange('yes')}
          className={
            'px-4 py-1.5 text-sm transition-colors ' +
            (value === 'yes'
              ? 'bg-[#09090B] text-white'
              : 'bg-white text-[#09090B] hover:bg-[#F3F4F6]')
          }
        >
          Yes
        </button>
        <button
          type="button"
          onClick={() => onChange('no')}
          className={
            'px-4 py-1.5 text-sm border-l border-[#E4E4E4] transition-colors ' +
            (value === 'no'
              ? 'bg-[#09090B] text-white'
              : 'bg-white text-[#09090B] hover:bg-[#F3F4F6]')
          }
        >
          No
        </button>
      </div>
    </div>
  );
}

export interface SalesKPIStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
  entry: SalesKPIEntry | null;
  nextStatus: SalesKPIStatus | null;
  onSaved: (updated: SalesKPIEntry) => void;
}

const STATUS_LABEL: Record<SalesKPIStatus, string> = {
  lead: 'Lead',
  awaiting_quote: 'Awaiting Quote',
  shared_with_client: 'Shared with Client',
  won: 'Won',
  lost: 'Lost',
};

export function SalesKPIStatusModal({
  isOpen,
  onClose,
  entry,
  nextStatus,
  onSaved,
}: SalesKPIStatusModalProps) {
  const [sentForQuote, setSentForQuote] = useState<WorkflowAnswer>(null);
  const [quoteReceived, setQuoteReceived] = useState<WorkflowAnswer>(null);
  const [submittedToClient, setSubmittedToClient] = useState<WorkflowAnswer>(null);
  const [convertedPremium, setConvertedPremium] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setSentForQuote(null);
    setQuoteReceived(null);
    setSubmittedToClient(null);
    setConvertedPremium('');
    setError('');
    setIsSubmitting(false);
  }, [isOpen, entry?.id, nextStatus]);

  if (!entry || !nextStatus) return null;

  // TED-533: Won asks only for Converted Premium (the three workflow answers
  // are forced to Yes server-side). Lost asks the three Yes/No questions only.
  // TED-538: a lost deal has no converted premium, so the premium field shows
  // for Won only.
  const isWon = nextStatus === 'won';
  const isLost = nextStatus === 'lost';
  const needsQuestions = isLost;
  const needsPremium = isWon;

  const allAnswered =
    sentForQuote !== null && quoteReceived !== null && submittedToClient !== null;
  const premiumNum = Number(convertedPremium);
  const premiumValid = isWon
    ? convertedPremium.trim() !== '' && Number.isFinite(premiumNum) && premiumNum > 0
    // Lost: optional — blank is fine; if entered, must be a non-negative number.
    : convertedPremium.trim() === '' || (Number.isFinite(premiumNum) && premiumNum >= 0);
  const canSubmit = (!needsQuestions || allAnswered) && premiumValid && !isSubmitting;

  const handleConfirm = async () => {
    setError('');
    if (!canSubmit) return;
    setIsSubmitting(true);

    const payload: SalesKPIStatusUpdatePayload = { status: nextStatus };
    if (needsQuestions) {
      payload.sent_for_quote = sentForQuote === 'yes';
      payload.quote_received = quoteReceived === 'yes';
      payload.submitted_to_client = submittedToClient === 'yes';
    }
    // Won always sends a (required, > 0) premium; Lost sends one only when the
    // optional field was filled.
    if (convertedPremium.trim() !== '') {
      payload.converted_premium = convertedPremium.trim();
    }

    const result = await updateSalesKPIStatus(entry.id, payload);
    setIsSubmitting(false);

    if (result.data) {
      toast.success(`Marked as ${STATUS_LABEL[nextStatus]}`);
      onSaved(result.data);
      onClose();
    } else {
      setError(result.error || 'Failed to update status');
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="p-0 sm:max-w-md">
        <DialogHeader className="border-b border-[#E4E4E4] p-4">
          <DialogTitle>Mark as {STATUS_LABEL[nextStatus]}</DialogTitle>
        </DialogHeader>

        <div className="p-4 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-md text-sm">
              {error}
            </div>
          )}

          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
            <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
            <p className="text-sm text-amber-800">
              This action cannot be reversed. Please confirm before proceeding.
            </p>
          </div>

          {needsQuestions && (
            <div className="space-y-3">
              <YesNoRow
                label="Have you sent this deal for quote creation?"
                value={sentForQuote}
                onChange={setSentForQuote}
              />
              <YesNoRow
                label="Have you received a quote from the operations team?"
                value={quoteReceived}
                onChange={setQuoteReceived}
              />
              <YesNoRow
                label="Have you submitted the quote to the client?"
                value={submittedToClient}
                onChange={setSubmittedToClient}
              />
            </div>
          )}

          {needsPremium && (
            <div className="space-y-2">
              <Label>Converted Premium (AED) *</Label>
              <NumberInput
                placeholder="0.00"
                value={convertedPremium}
                onValueChange={setConvertedPremium}
                autoFocus={!needsQuestions}
              />
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-[#E4E4E4] p-4">
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={!canSubmit}>
            {isSubmitting ? 'Saving…' : 'Confirm & Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
