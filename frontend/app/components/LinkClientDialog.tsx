'use client';

/**
 * Marine New only: link a legacy enquiry (free-text client_name, no saved
 * client) to a client from the saved Client list.
 *
 * Step 1 shows the previously typed name for reference, a "search first"
 * warning, and a ClientSelect (server-side search, infinite scroll, create-new
 * with duplicate warning). Step 2 confirms, because linking is permanent: the
 * backend sets the client and clears the old client_name in one save, and a
 * linked row can never be re-linked.
 */

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { ClientSelect, clientLabel } from '@/app/components/ClientSelect';
import {
  firstFieldError,
  linkMarineClient,
  type ClientRef,
  type MotorEnquiryEntry,
} from '@/app/lib/api';

export interface LinkClientDialogProps {
  // The enquiry to link; null keeps the dialog closed.
  entry: MotorEnquiryEntry | null;
  onClose: () => void;
  // Called after a successful link with the updated row.
  onLinked: (entry: MotorEnquiryEntry) => void;
  // Called when the server refuses the link for a reason other than the
  // picked client (already linked elsewhere, voided, past cutoff, not the
  // creator): the row is stale, so the parent should close and refresh it.
  onStale?: (message: string) => void;
}

export function LinkClientDialog({ entry, onClose, onLinked, onStale }: LinkClientDialogProps) {
  const [client, setClient] = useState<ClientRef | null>(null);
  const [step, setStep] = useState<'pick' | 'confirm'>('pick');
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Sync guard: a fast double click lands before isSubmitting re-renders.
  const submittingRef = useRef(false);
  const [error, setError] = useState('');

  // Reset whenever a different row is opened.
  useEffect(() => {
    setClient(null);
    setStep('pick');
    setError('');
    setIsSubmitting(false);
    submittingRef.current = false;
  }, [entry?.id]);

  if (!entry) return null;

  const close = () => {
    if (submittingRef.current) return;
    onClose();
  };

  const handleLink = async () => {
    if (!client || submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    setError('');
    const res = await linkMarineClient(entry.id, client.id);
    submittingRef.current = false;
    setIsSubmitting(false);
    if (res.data) {
      toast.success(`Linked ${entry.pib_id} to ${client.name}`);
      onLinked(res.data);
      return;
    }
    const message =
      firstFieldError(res, ['client', 'non_field_errors', 'detail']) ||
      res.error ||
      'Failed to link client';
    // A picked-client problem is fixable on the first step; go back to it.
    if (firstFieldError(res, ['client'])) {
      setError(message);
      setStep('pick');
      return;
    }
    // Any other server refusal means the row itself changed (linked from
    // another tab, voided, ...): retrying cannot succeed, so hand back to the
    // parent to close and refresh. Network/5xx errors (no `detail`) stay
    // retryable.
    if (firstFieldError(res, ['detail']) && onStale) {
      onStale(message);
      return;
    }
    setError(message);
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
      {/* Clicking outside must not close the dialog and lose the pick;
          close only via Cancel / X / Esc. */}
      <DialogContent className="p-0 sm:max-w-lg" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader className="border-b border-[#E4E4E4] p-4">
          <DialogTitle>Link client · {entry.pib_id}</DialogTitle>
        </DialogHeader>

        <div className="p-4 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-md text-sm">
              {error}
            </div>
          )}

          <div className="rounded-md border border-[#E4E4E4] bg-[#FAFAFA] px-3 py-2 text-sm">
            <span className="text-[#71717A]">Previously entered: </span>
            <span className="font-medium text-[#09090B] break-words">
              {entry.client_name || '—'}
            </span>
          </div>

          {step === 'pick' ? (
            <>
              <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <p>
                  <span className="font-semibold">Search first</span> — check the client
                  doesn&apos;t already exist before creating a new one.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Client *</Label>
                <ClientSelect
                  category="marine"
                  value={client?.id ?? null}
                  onChange={(c) => {
                    setClient(c);
                    setError('');
                  }}
                  selectedLabel={client ? clientLabel(client) : null}
                  placeholder="Search saved clients"
                />
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-[#09090B]">
                Link this enquiry to{' '}
                <span className="font-semibold">{client ? clientLabel(client) : ''}</span>?
              </p>
              <div className="flex gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <p>Linking is permanent and clears the old typed name.</p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="p-4 border-t border-[#E4E4E4]">
          {step === 'pick' ? (
            <>
              <Button type="button" variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={!client}
                onClick={() => {
                  setError('');
                  setStep('confirm');
                }}
              >
                Continue
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting}
                onClick={() => setStep('pick')}
              >
                Back
              </Button>
              <Button type="button" disabled={isSubmitting || !client} onClick={handleLink}>
                {isSubmitting ? 'Linking…' : 'Link permanently'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
