'use client';

import { useState } from 'react';
import { Download, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ExportTrackerDialog, type ExportUser } from '@/app/components/ExportTrackerDialog';
import { ExportEnquiriesDialog } from '@/app/components/ExportEnquiriesDialog';
import type { EnquiryExportFormat } from '@/app/lib/api';

interface ExportTrackerButtonProps {
  moduleKey: string;
  moduleUsers: ExportUser[];
  /** When set, adds an "Enquiries" item that opens the CSV / Excel format dialog. */
  onExportEnquiries?: (fileFormat: EnquiryExportFormat) => Promise<boolean>;
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
}: ExportTrackerButtonProps) {
  const [open, setOpen] = useState(false);
  const [enquiriesOpen, setEnquiriesOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">
            <Download className="h-4 w-4 mr-2" />
            Export
            <ChevronDown className="h-4 w-4 ml-2 text-[#71717A]" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-[160px] bg-white border border-[#E4E4E4] rounded-lg p-1 shadow-md"
        >
          <DropdownMenuItem
            onClick={() => setOpen(true)}
            className="cursor-pointer px-3 py-2 text-sm text-[#09090B] rounded-md"
          >
            Tracker
          </DropdownMenuItem>
          {onExportEnquiries && (
            <DropdownMenuItem
              onClick={() => setEnquiriesOpen(true)}
              className="cursor-pointer px-3 py-2 text-sm text-[#09090B] rounded-md"
            >
              Enquiries
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <ExportTrackerDialog
        open={open}
        onOpenChange={setOpen}
        moduleKey={moduleKey}
        moduleUsers={moduleUsers}
      />
      {onExportEnquiries && (
        <ExportEnquiriesDialog
          open={enquiriesOpen}
          onOpenChange={setEnquiriesOpen}
          onExport={onExportEnquiries}
        />
      )}
    </>
  );
}
