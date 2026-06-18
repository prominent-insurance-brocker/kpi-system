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

interface ExportTrackerButtonProps {
  moduleKey: string;
  moduleUsers: ExportUser[];
}

/**
 * TED-554: header action — "Export ▾" → "Tracker" opens the export modal.
 * Dropped into each module page's top-right header (next to Monthly Targets /
 * the primary action). Callers gate it to admin/HOD (whoever sees the team
 * tracker).
 */
export function ExportTrackerButton({ moduleKey, moduleUsers }: ExportTrackerButtonProps) {
  const [open, setOpen] = useState(false);
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
