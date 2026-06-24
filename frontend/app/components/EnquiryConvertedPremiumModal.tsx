'use client';

/**
 * Edit the Converted Premium on a converted enquiry after it's terminal.
 *
 * Converted enquiries are otherwise locked (Edit/Delete hidden, status frozen),
 * but the converted premium often needs correcting post-close. Opened from the
 * row's 3-dot menu; pre-filled with the current value. Mirrors the Sales KPI
 * ("Deals") converted-premium modal, but works across the per-enquiry "new"
 * modules (general-new, motor-new, motor-fleet-new) via the module's
 * update-converted-premium action.
 */

import { useEffect, useState } from 'react';
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
  updateEnquiryConvertedPremium,
  type MotorEnquiryEntry,
  type MotorEnquiryModule,
} from '@/app/lib/api';

export interface EnquiryConvertedPremiumModalProps {
  isOpen: boolean;
  onClose: () => void;
  module: MotorEnquiryModule;
  entry: MotorEnquiryEntry | null;
  onSaved: () => void;
}

export function EnquiryConvertedPremiumModal({
  isOpen,
  onClose,
  module,
  entry,
  onSaved,
}: EnquiryConvertedPremiumModalProps) {
  const [value, setValue] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    // Pre-fill with the enquiry's current converted premium.
    setValue(entry?.converted_premium != null ? String(entry.converted_premium) : '');
    setError('');
    setIsSubmitting(false);
  }, [isOpen, entry?.id, entry?.converted_premium]);

  if (!entry) return null;

  const num = Number(value);
  const valid = value.trim() !== '' && Number.isFinite(num) && num > 0;

  const handleSave = async () => {
    setError('');
    if (!valid) return;
    setIsSubmitting(true);
    const result = await updateEnquiryConvertedPremium(module, entry.id, value.trim());
    setIsSubmitting(false);
    if (result.data) {
      toast.success('Converted premium updated');
      onSaved();
      onClose();
    } else {
      setError(result.error || 'Failed to update converted premium');
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="p-0 sm:max-w-md">
        <DialogHeader className="border-b border-[#E4E4E4] p-4">
          <DialogTitle>Update Converted Premium</DialogTitle>
        </DialogHeader>

        <div className="p-4 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-md text-sm">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label>Converted Premium (AED) *</Label>
            <NumberInput
              placeholder="0.00"
              value={value}
              onValueChange={setValue}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              {entry.client_name} · {entry.pib_id}
            </p>
          </div>
        </div>

        <DialogFooter className="border-t border-[#E4E4E4] p-4">
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={!valid || isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
