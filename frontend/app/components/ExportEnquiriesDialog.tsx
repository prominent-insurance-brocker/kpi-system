'use client';

import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import type { EnquiryExportFormat } from '@/app/lib/api';

interface ExportEnquiriesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Runs the export; resolves true on success so the dialog can close. */
  onExport: (fileFormat: EnquiryExportFormat) => Promise<boolean>;
}

const FORMAT_OPTIONS: { value: EnquiryExportFormat; title: string; desc: string }[] = [
  { value: 'csv', title: 'CSV', desc: 'Plain text, opens in Excel, Sheets or any tool' },
  { value: 'xlsx', title: 'Excel (.xlsx)', desc: 'Typed numbers and dates, filterable header' },
];

export function ExportEnquiriesDialog({ open, onOpenChange, onExport }: ExportEnquiriesDialogProps) {
  const [fileFormat, setFileFormat] = useState<EnquiryExportFormat>('csv');
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    if (open) setFileFormat('csv');
  }, [open]);

  const handleExport = async () => {
    setIsExporting(true);
    const ok = await onExport(fileFormat);
    setIsExporting(false);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !isExporting && onOpenChange(o)}>
      <DialogContent className="sm:max-w-[440px] p-0 gap-0">
        <DialogHeader className="p-5 border-b border-[#E4E4E4]">
          <DialogTitle className="text-base">Export Enquiries</DialogTitle>
          <DialogDescription>
            Exports every enquiry matching the current filters, one row per enquiry.
          </DialogDescription>
        </DialogHeader>

        <div className="p-5 space-y-2">
          <span className="text-sm font-medium text-[#09090B]">Format</span>
          <RadioGroup
            value={fileFormat}
            onValueChange={(v) => setFileFormat(v as EnquiryExportFormat)}
            className="gap-2"
          >
            {FORMAT_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`flex items-start gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-colors ${
                  fileFormat === opt.value
                    ? 'border-[#09090B]'
                    : 'border-[#E4E4E4] hover:bg-[#FAFAFA]'
                }`}
              >
                <RadioGroupItem value={opt.value} className="mt-0.5" />
                <span className="flex flex-col">
                  <span className="text-sm font-medium text-[#09090B]">{opt.title}</span>
                  <span className="text-xs text-[#71717A]">{opt.desc}</span>
                </span>
              </label>
            ))}
          </RadioGroup>
        </div>

        <DialogFooter className="p-4 border-t border-[#E4E4E4]">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isExporting}>
            Cancel
          </Button>
          <Button onClick={handleExport} disabled={isExporting}>
            <Download className="h-4 w-4 mr-1" />
            {isExporting ? 'Exporting…' : 'Export'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
