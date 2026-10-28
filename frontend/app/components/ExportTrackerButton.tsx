'use client';

import { useState } from 'react';
import { Download, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ExportTrackerDialog, type ExportUser } from '@/app/components/ExportTrackerDialog';
import type { EnquiryExportFormat } from '@/app/lib/api';

interface ExportTrackerButtonProps {
  moduleKey: string;
  moduleUsers: ExportUser[];
  /** When set, adds "Enquiries (CSV)" / "Enquiries (Excel)" items. */
  onExportEnquiries?: (fileFormat: EnquiryExportFormat) => void;
  exportingEnquiries?: boolean;
}

/**
 * TED-554: header action — "Export ▾" → "Tracker" opens the export modal.
 * Dropped into each module page's top-right header (next to Monthly Targets /
 * the primary action). Callers gate it to admin/HOD (whoever sees the team
 * tracker). Pages that pass `onExportEnquiries` also get per-enquiry exports.
 */
export function ExportTrackerButton({
  moduleKey,
  moduleUsers,
  onExportEnquiries,
  exportingEnquiries = false,
}: ExportTrackerButtonProps) {
  const [open, setOpen] = useState(false);
  const itemClass = 'cursor-pointer px-3 py-2 text-sm text-[#09090B] rounded-md';
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" disabled={exportingEnquiries}>
            <Download className="h-4 w-4 mr-2" />
            {exportingEnquiries ? 'Exporting…' : 'Export'}
            <ChevronDown className="h-4 w-4 ml-2 text-[#71717A]" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className={`${onExportEnquiries ? 'w-[190px]' : 'w-[160px]'} bg-white border border-[#E4E4E4] rounded-lg p-1 shadow-md`}
        >
          <DropdownMenuItem onClick={() => setOpen(true)} className={itemClass}>
            Tracker
          </DropdownMenuItem>
          {onExportEnquiries && (
            <>
              <DropdownMenuSeparator className="bg-[#E4E4E4]" />
              <DropdownMenuItem onClick={() => onExportEnquiries('csv')} className={itemClass}>
                Enquiries (CSV)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onExportEnquiries('xlsx')} className={itemClass}>
                Enquiries (Excel)
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <ExportTrackerDialog
        open={open}
        onOpenChange={setOpen}
        moduleKey={moduleKey}
        moduleUsers={moduleUsers}
      />
    </>
  );
}
