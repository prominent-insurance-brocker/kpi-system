'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search, Download } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { FormDatePicker } from '@/components/ui/form-date-picker';
import { exportTrackerXlsx, downloadBlob } from '@/app/lib/api';
import { toast } from 'sonner';

export interface ExportUser {
  id: number;
  full_name: string;
  email: string;
  role_name?: string | null;
}

interface ExportTrackerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  moduleKey: string;
  moduleUsers: ExportUser[];
  // Pre-seed selection from the tracker's current user filter (string ids).
  // Empty => select all members.
  defaultSelectedUserIds?: string[];
}

type RangeType = 'recent' | 'previous' | 'custom';

const RANGE_OPTIONS: { value: RangeType; title: string; desc: string }[] = [
  { value: 'recent', title: 'Recent', desc: "Current month up to yesterday's EOD" },
  { value: 'previous', title: 'Previous month', desc: 'Exports the entire previous month' },
  { value: 'custom', title: 'Custom', desc: 'Choose a specific start and end date' },
];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// [start, end] (YYYY-MM-DD, local) for the preset ranges, computed at call time.
function presetRange(type: 'recent' | 'previous'): { start: string; end: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  if (type === 'recent') {
    const first = new Date(y, m, 1);
    const yesterday = new Date(y, m, now.getDate() - 1);
    // On the 1st of the month "up to yesterday" lands before the month start;
    // clamp so start <= end (exports just yesterday).
    const start = yesterday < first ? yesterday : first;
    return { start: ymd(start), end: ymd(yesterday) };
  }
  const first = new Date(y, m - 1, 1);
  const last = new Date(y, m, 0); // day 0 of this month = last day of previous month
  return { start: ymd(first), end: ymd(last) };
}

function Avatar({ name }: { name: string }) {
  return (
    <span className="w-7 h-7 rounded-full bg-[#6366F1] text-white flex items-center justify-center text-xs font-semibold uppercase shrink-0">
      {name.charAt(0)}
    </span>
  );
}

export function ExportTrackerDialog({
  open,
  onOpenChange,
  moduleKey,
  moduleUsers,
  defaultSelectedUserIds = [],
}: ExportTrackerDialogProps) {
  const allIds = useMemo(() => moduleUsers.map((u) => u.id), [moduleUsers]);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState('');
  const [rangeType, setRangeType] = useState<RangeType>('recent');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [isExporting, setIsExporting] = useState(false);

  // (Re)initialise each time the dialog opens so it reflects the live filter.
  useEffect(() => {
    if (!open) return;
    const seed =
      defaultSelectedUserIds.length > 0
        ? new Set(defaultSelectedUserIds.map(Number))
        : new Set(allIds);
    setSelectedIds(seed);
    setSearch('');
    setRangeType('recent');
    const r = presetRange('recent');
    setCustomStart(r.start);
    setCustomEnd(r.end);
    // Only re-seed on open; allIds/defaults are read fresh inside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return moduleUsers;
    return moduleUsers.filter(
      (u) =>
        u.full_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
    );
  }, [moduleUsers, search]);

  const total = moduleUsers.length;
  const selectedCount = selectedIds.size;
  const allSelected = total > 0 && selectedCount === total;
  const someSelected = selectedCount > 0 && selectedCount < total;

  const toggleUser = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(allIds));
  };

  const handleExport = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) {
      toast.error('Select at least one user to export.');
      return;
    }

    let start: string;
    let end: string;
    if (rangeType === 'custom') {
      if (!customStart || !customEnd) {
        toast.error('Pick a start and end date.');
        return;
      }
      if (customStart > customEnd) {
        toast.error('Start date must be on or before the end date.');
        return;
      }
      start = customStart;
      end = customEnd;
    } else {
      ({ start, end } = presetRange(rangeType));
    }

    setIsExporting(true);
    const res = await exportTrackerXlsx({ module: moduleKey, userIds: ids, start, end });
    setIsExporting(false);

    if (res.error || !res.data) {
      toast.error(res.error || 'Export failed.');
      return;
    }
    downloadBlob(res.data, `tracker_${moduleKey}_${start}_${end}.xlsx`);
    toast.success('Tracker exported.');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] p-0 gap-0">
        <DialogHeader className="p-5 border-b border-[#E4E4E4]">
          <DialogTitle className="text-base">Export Tracker Data</DialogTitle>
          <DialogDescription>
            Generates an Excel (.xlsx) file for the selection below.
          </DialogDescription>
        </DialogHeader>

        <div className="p-5 space-y-5 max-h-[60vh] overflow-y-auto">
          {/* Users */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-[#09090B]">Users</span>
              <span className="text-xs text-[#71717A]">
                {selectedCount} of {total} selected
              </span>
            </div>

            <div className="rounded-lg border border-[#E4E4E4] overflow-hidden">
              <div className="flex items-center border-b border-[#E4E4E4] px-3 py-2">
                <Search className="mr-2 h-4 w-4 shrink-0 text-[#9CA3AF]" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search users…"
                  className="flex-1 bg-transparent text-sm outline-none placeholder:text-[#9CA3AF]"
                />
              </div>

              <div className="max-h-[220px] overflow-y-auto">
                {/* All users */}
                <label className="flex items-center gap-3 px-3 py-2 border-b border-[#E4E4E4] bg-[#FAFAFA] cursor-pointer">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                    onCheckedChange={toggleAll}
                  />
                  <span className="text-sm font-medium text-[#09090B] flex-1">All users</span>
                  <span className="text-xs text-[#71717A] rounded-full border border-[#E4E4E4] px-2 py-0.5">
                    {total}
                  </span>
                </label>

                {filtered.length === 0 ? (
                  <div className="px-3 py-6 text-center text-sm text-[#71717A]">
                    No users found
                  </div>
                ) : (
                  filtered.map((u) => (
                    <label
                      key={u.id}
                      className="flex items-center gap-3 px-3 py-2 border-b border-[#F1F1F1] last:border-b-0 cursor-pointer hover:bg-[#FAFAFA]"
                    >
                      <Checkbox
                        checked={selectedIds.has(u.id)}
                        onCheckedChange={() => toggleUser(u.id)}
                      />
                      <Avatar name={u.full_name} />
                      <span className="text-sm text-[#09090B] flex-1 truncate">
                        {u.full_name}
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>
            <p className="text-xs text-[#9CA3AF]">
              Choose All to include everyone, or select individual team members.
            </p>
          </div>

          {/* Date range */}
          <div className="space-y-2">
            <span className="text-sm font-medium text-[#09090B]">Date range</span>
            <RadioGroup
              value={rangeType}
              onValueChange={(v) => setRangeType(v as RangeType)}
              className="gap-2"
            >
              {RANGE_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-start gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-colors ${
                    rangeType === opt.value
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

            {rangeType === 'custom' && (
              <div className="grid grid-cols-2 gap-3 pt-1">
                <FormDatePicker label="Start date" value={customStart} onChange={setCustomStart} />
                <FormDatePicker label="End date" value={customEnd} onChange={setCustomEnd} />
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="p-4 border-t border-[#E4E4E4]">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isExporting}>
            Cancel
          </Button>
          <Button onClick={handleExport} disabled={isExporting || selectedCount === 0}>
            <Download className="h-4 w-4 mr-1" />
            {isExporting ? 'Exporting…' : 'Export'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
