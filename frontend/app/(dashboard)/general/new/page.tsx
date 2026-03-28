'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DataTable } from '@/app/components/DataTable';
import { API_BASE_URL } from '@/app/lib/api';
import { CalendarDays, ChevronLeft, ChevronRight, Plus, MoreHorizontal } from 'lucide-react';
import { FormDatePicker } from '@/components/ui/form-date-picker';
import { formatDate, formatDateTime } from '@/app/lib/date';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';

interface GeneralNewEntry {
  id: number;
  date: string;
  quotations: number;
  quotes_revised: number;
  quotes_converted: number;
  tat: number | null;
  accuracy: number | null;
  added_by: number;
  added_by_name: string;
  added_at: string;
  is_editable: boolean;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setDate(d.getDate() + diff);
  mon.setHours(0, 0, 0, 0);
  return mon;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const SHORT_DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ type }: { type: 'submitted' | 'not_submitted' | 'upcoming' }) {
  if (type === 'submitted') {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-[#16A34A]">
        <span className="w-2 h-2 rounded-full bg-[#16A34A] shrink-0" />
        Submitted
      </span>
    );
  }
  if (type === 'not_submitted') {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-[#DC2626]">
        <span className="w-2 h-2 rounded-full bg-[#DC2626] shrink-0" />
        Not submitted
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-[#71717A]">
      <span className="w-2 h-2 rounded-full bg-[#D4D4D4] shrink-0" />
      Upcoming
    </span>
  );
}

// ─── Weekly View ─────────────────────────────────────────────────────────────

function WeeklyView({
  weekStart,
  monthEntries,
  today,
  onPrevWeek,
  onNextWeek,
  onAddRecord,
  onEdit,
  onDelete,
}: {
  weekStart: Date;
  monthEntries: GeneralNewEntry[];
  today: Date;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onAddRecord: (date: string) => void;
  onEdit: (entry: GeneralNewEntry) => void;
  onDelete: (entry: GeneralNewEntry) => void;
}) {
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const getEntriesForDay = (d: Date): GeneralNewEntry[] => {
    const ds = toLocalDateString(d);
    return monthEntries
      .filter((e) => e.date === ds)
      .sort((a, b) => new Date(b.added_at).getTime() - new Date(a.added_at).getTime());
  };

  const isFutureDay = (d: Date) => {
    const s = new Date(d); s.setHours(0, 0, 0, 0);
    const t = new Date(today); t.setHours(0, 0, 0, 0);
    return s > t;
  };
  const isPastDay = (d: Date) => {
    const s = new Date(d); s.setHours(0, 0, 0, 0);
    const t = new Date(today); t.setHours(0, 0, 0, 0);
    return s < t;
  };

  const weekEndDay = addDays(weekStart, 6);
  const weekMonthLabel =
    weekStart.getMonth() === weekEndDay.getMonth()
      ? `${MONTH_NAMES[weekStart.getMonth()]} ${weekStart.getFullYear()}`
      : `${MONTH_NAMES[weekStart.getMonth()]} – ${MONTH_NAMES[weekEndDay.getMonth()]} ${weekEndDay.getFullYear()}`;

  return (
    <div className="space-y-4">
      {/* Week navigation bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            onClick={onPrevWeek}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[#F3F3F3] transition-colors"
          >
            <ChevronLeft className="h-4 w-4 text-[#71717A]" />
          </button>
          <span className="text-sm font-medium text-[#09090B] px-1">This Week</span>
          <button
            onClick={onNextWeek}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[#F3F3F3] transition-colors"
          >
            <ChevronRight className="h-4 w-4 text-[#71717A]" />
          </button>
        </div>
        <span className="text-sm font-semibold text-[#09090B]">{weekMonthLabel}</span>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-[#E4E4E4] overflow-hidden">
        <Table>
          <TableHeader className="bg-[#F9F9F9] [&_tr]:border-b [&_tr]:border-[#E4E4E4]">
            <TableRow className="hover:bg-transparent">
              <TableHead className="px-5 py-3 text-xs font-medium text-[#71717A] uppercase tracking-wide w-[140px]">
                Day
              </TableHead>
              <TableHead className="px-5 py-3 text-xs font-medium text-[#71717A] uppercase tracking-wide">
                Quotations
              </TableHead>
              <TableHead className="px-5 py-3 text-xs font-medium text-[#71717A] uppercase tracking-wide">
                Quotes revised
              </TableHead>
              <TableHead className="px-5 py-3 text-xs font-medium text-[#71717A] uppercase tracking-wide">
                Quotes converted
              </TableHead>
              <TableHead className="px-5 py-3 text-xs font-medium text-[#71717A] uppercase tracking-wide">
                Added by
              </TableHead>
              <TableHead className="px-5 py-3 text-xs font-medium text-[#71717A] uppercase tracking-wide w-[180px]">
                Status
              </TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {weekDays.map((d, idx) => {
              const isSun = d.getDay() === 0;
              const isToday = sameDay(d, today);
              const entries = getEntriesForDay(d);
              const latestEntry = entries[0] ?? null;
              const hasEntry = entries.length > 0;
              const past = isPastDay(d);

              let statusType: 'submitted' | 'not_submitted' | 'upcoming' = 'upcoming';
              if (hasEntry) statusType = 'submitted';
              else if (past) statusType = 'not_submitted';

              return (
                <TableRow
                  key={toLocalDateString(d)}
                  className={`h-[64px] border-b border-[#F3F3F3] last:border-0 ${
                    isSun
                      ? 'bg-[#FAFAFA] opacity-60 hover:bg-[#FAFAFA]'
                      : isToday && hasEntry
                      ? 'bg-[#F0FDF4] hover:bg-[#ECFDF5]'
                      : isToday
                      ? 'bg-[#F5F3FF] hover:bg-[#EEF2FF]'
                      : 'bg-white hover:bg-[#FAFAFA]'
                  }`}
                >
                  {/* Day */}
                  <TableCell className="px-5 py-3">
                    <div className="flex flex-col gap-0.5">
                      <span className={`text-sm font-semibold leading-tight ${isToday ? 'text-[#4F46E5]' : 'text-[#09090B]'}`}>
                        {WEEKDAY_NAMES[idx]}
                      </span>
                      <span className="text-xs text-[#9CA3AF] leading-tight">
                        {d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                  </TableCell>

                  {/* Quotations */}
                  <TableCell className="px-5 py-3 text-sm font-medium text-[#374151]">
                    {latestEntry ? latestEntry.quotations : <span className="text-[#D1D5DB]">—</span>}
                  </TableCell>

                  {/* Quotes revised */}
                  <TableCell className="px-5 py-3 text-sm font-medium text-[#374151]">
                    {latestEntry ? latestEntry.quotes_revised : <span className="text-[#D1D5DB]">—</span>}
                  </TableCell>

                  {/* Quotes converted */}
                  <TableCell className="px-5 py-3 text-sm font-medium text-[#374151]">
                    {latestEntry ? latestEntry.quotes_converted : <span className="text-[#D1D5DB]">—</span>}
                  </TableCell>

                  {/* Added by */}
                  <TableCell className="px-5 py-3">
                    {latestEntry ? (
                      <div className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-full bg-[#6366F1] text-white text-xs flex items-center justify-center font-semibold uppercase shrink-0">
                          {latestEntry.added_by_name.charAt(0)}
                        </span>
                        <span className="text-sm font-medium text-[#374151] truncate max-w-[120px]">
                          {latestEntry.added_by_name}
                        </span>
                      </div>
                    ) : <span className="text-[#D1D5DB]">—</span>}
                  </TableCell>

                  {/* Status */}
                  <TableCell className="px-5 py-3">
                    {!isSun && (
                      isToday && !hasEntry ? (
                        <Button
                          size="sm"
                          className="h-8 px-3 text-xs font-medium bg-[#09090B] hover:bg-[#1a1a1a] text-white rounded-lg gap-1"
                          onClick={() => onAddRecord(toLocalDateString(d))}
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Add record
                        </Button>
                      ) : (
                        <StatusBadge type={statusType} />
                      )
                    )}
                  </TableCell>

                  {/* Three-dot menu */}
                  <TableCell className="px-3 py-3">
                    {!isSun && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="w-8 h-8 flex items-center justify-center rounded-md text-[#9CA3AF] hover:text-[#09090B] hover:bg-[#F3F3F3] transition-colors">
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          className="w-[149px] bg-white border border-[#E4E4E4] rounded-lg p-1 shadow-md"
                        >
                          {!hasEntry && (
                            <DropdownMenuItem
                              onClick={() => onAddRecord(toLocalDateString(d))}
                              className="cursor-pointer px-3 py-2 text-sm text-[#09090B] rounded-md"
                            >
                              Add record
                            </DropdownMenuItem>
                          )}
                          {hasEntry && latestEntry && (
                            <>
                              {latestEntry.is_editable && (
                                <DropdownMenuItem
                                  onClick={() => onEdit(latestEntry)}
                                  className="cursor-pointer px-3 py-2 text-sm text-[#09090B] rounded-md"
                                >
                                  Edit
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                onClick={() => onDelete(latestEntry)}
                                className="cursor-pointer px-3 py-2 text-sm text-red-600 rounded-md"
                              >
                                Delete
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── Data View columns ───────────────────────────────────────────────────────

const dataColumns = [
  {
    key: 'date',
    header: 'Record date',
    render: (item: GeneralNewEntry) => formatDate(item.date),
  },
  { key: 'quotations', header: 'Quotations' },
  { key: 'quotes_revised', header: 'Quotes revised' },
  { key: 'quotes_converted', header: 'Quotes converted' },
  { key: 'added_by_name', header: 'Added by' },
  {
    key: 'added_at',
    header: 'Added on',
    render: (item: GeneralNewEntry) => formatDateTime(item.added_at),
  },
];

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function GeneralNewPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const [weekStart, setWeekStart] = useState<Date>(startOfWeek(today));
  const [activeTab, setActiveTab] = useState<'weekly' | 'data'>('weekly');

  const [monthEntries, setMonthEntries] = useState<GeneralNewEntry[]>([]);

  const [dataEntries, setDataEntries] = useState<GeneralNewEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [dataLoading, setDataLoading] = useState(false);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<GeneralNewEntry | null>(null);
  const [modalDate, setModalDate] = useState('');
  const [modalError, setModalError] = useState('');

  const page = Number(searchParams.get('page')) || 1;
  const pageSize = Number(searchParams.get('pageSize')) || 10;

  const updateParams = (updates: Record<string, string | number>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (value) params.set(key, String(value));
      else params.delete(key);
    });
    router.push(`?${params.toString()}`);
  };

  const fetchMonthEntries = useCallback(async (year: number, month: number) => {
    try {
      const firstDay = `${year}-${String(month + 1).padStart(2, '0')}-01`;
      const lastDay = toLocalDateString(new Date(year, month + 1, 0));
      const params = new URLSearchParams({ date_from: firstDay, date_to: lastDay, page_size: '1000' });
      const res = await fetch(`${API_BASE_URL}/api/entries/general-new/?${params}`, { credentials: 'include' });
      const data = await res.json();
      setMonthEntries(data.results || []);
    } catch {
      setMonthEntries([]);
    }
  }, []);

  const fetchDataEntries = useCallback(async () => {
    setDataLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
      const res = await fetch(`${API_BASE_URL}/api/entries/general-new/?${params}`, { credentials: 'include' });
      const data = await res.json();
      setDataEntries(data.results || []);
      setTotalCount(data.count || 0);
    } catch {
      setDataEntries([]);
    }
    setDataLoading(false);
  }, [page, pageSize]);

  useEffect(() => { fetchMonthEntries(calYear, calMonth); }, [calYear, calMonth, fetchMonthEntries]);
  useEffect(() => { if (activeTab === 'data') fetchDataEntries(); }, [activeTab, page, pageSize, fetchDataEntries]);

  const entryDates = new Set(monthEntries.map((e) => e.date));

  const prevMonth = () => {
    if (calMonth === 0) { setCalYear(y => y - 1); setCalMonth(11); }
    else setCalMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (calMonth === 11) { setCalYear(y => y + 1); setCalMonth(0); }
    else setCalMonth(m => m + 1);
  };
  const goToday = () => { setCalYear(today.getFullYear()); setCalMonth(today.getMonth()); };

  const handleSave = async (formData: Partial<GeneralNewEntry>) => {
    setModalError('');
    const url = editingEntry
      ? `${API_BASE_URL}/api/entries/general-new/${editingEntry.id}/`
      : `${API_BASE_URL}/api/entries/general-new/`;
    const res = await fetch(url, {
      method: editingEntry ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(formData),
    });
    if (res.ok) {
      setIsModalOpen(false);
      setEditingEntry(null);
      setModalDate('');
      fetchMonthEntries(calYear, calMonth);
      if (activeTab === 'data') fetchDataEntries();
    } else {
      const data = await res.json();
      setModalError(data.error || Object.values(data).flat().join(', ') || 'Failed to save entry');
    }
  };

  const handleDelete = async (entry: GeneralNewEntry) => {
    if (!confirm('Are you sure you want to delete this entry?')) return;
    const res = await fetch(`${API_BASE_URL}/api/entries/general-new/${entry.id}/`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (res.ok) {
      fetchMonthEntries(calYear, calMonth);
      if (activeTab === 'data') fetchDataEntries();
    } else {
      const data = await res.json();
      alert(data.error || 'Failed to delete entry');
    }
  };

  const openAddModal = (date?: string) => {
    setEditingEntry(null);
    setModalError('');
    setModalDate(date || toLocalDateString(today));
    setIsModalOpen(true);
  };
  const openEditModal = (entry: GeneralNewEntry) => {
    setEditingEntry(entry);
    setModalError('');
    setModalDate('');
    setIsModalOpen(true);
  };

  // ── Calendar days ──
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const calDays: Date[] = Array.from({ length: daysInMonth }, (_, i) => new Date(calYear, calMonth, i + 1));

  return (
    <div className="p-6 space-y-5">
      <h1 className="text-2xl font-bold text-[#09090B]">General New</h1>

      {/* ── Unified Daily Tracker Card ── */}
      <div className="bg-white rounded-2xl border border-[#E4E4E4] shadow-sm overflow-hidden">

        {/* Card header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E4E4E4]">
          {/* Left: icon + title */}
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-[#71717A]" />
            <span className="text-sm font-semibold text-[#09090B]">Daily Tracker</span>
          </div>

          {/* Right: Month/Year toggle + navigation */}
          <div className="flex items-center gap-4">
            {/* Month / Year pill */}
            <div className="flex items-center rounded-lg border border-[#E4E4E4] overflow-hidden text-xs font-medium">
              <button className="px-3 py-1.5 bg-white text-[#09090B] border-r border-[#E4E4E4]">
                Month
              </button>
              <button className="px-3 py-1.5 text-[#71717A] hover:bg-[#F9F9F9] transition-colors">
                Year
              </button>
            </div>

            {/* Nav arrows + Today */}
            <div className="flex items-center gap-1">
              <button
                onClick={prevMonth}
                className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[#F3F3F3] transition-colors"
              >
                <ChevronLeft className="h-4 w-4 text-[#71717A]" />
              </button>
              <button
                onClick={goToday}
                className="text-sm font-medium text-[#09090B] px-2 py-1 rounded-md hover:bg-[#F3F3F3] transition-colors"
              >
                Today
              </button>
              <button
                onClick={nextMonth}
                className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[#F3F3F3] transition-colors"
              >
                <ChevronRight className="h-4 w-4 text-[#71717A]" />
              </button>
            </div>

            {/* Month label */}
            <span className="text-sm font-semibold text-[#09090B] min-w-[110px] text-right">
              {MONTH_NAMES[calMonth]} {calYear}
            </span>
          </div>
        </div>

        {/* Calendar strip */}
        <div className="px-5 py-4 border-b border-[#E4E4E4] overflow-x-auto">
          <div className="flex gap-1 min-w-max">
            {calDays.map((d) => {
              const ds = toLocalDateString(d);
              const isSunday = d.getDay() === 0;
              const isToday = sameDay(d, today);
              const isPast = d < today && !isToday;
              const hasEntry = entryDates.has(ds);

              let cellBg = '';
              let cellStyle: React.CSSProperties | undefined;

              if (isSunday) {
                cellStyle = {
                  backgroundImage:
                    'repeating-linear-gradient(135deg,#D1D5DB 0,#D1D5DB 1px,transparent 1px,transparent 6px)',
                  backgroundColor: '#F9FAFB',
                };
              } else if (hasEntry) {
                // Green when entry exists — even for today
                cellBg = 'bg-[#DCFCE7]';
              } else if (isToday) {
                // Blue/indigo only when today has no entry yet
                cellBg = 'bg-[#EEF2FF]';
              } else if (isPast) {
                cellBg = 'bg-[#FEE2E2]';
              }

              return (
                <div
                  key={d.getDate()}
                  className={`flex flex-col items-center justify-center w-9 h-12 rounded-lg select-none ${cellBg}`}
                  style={cellStyle}
                >
                  <span
                    className={`text-sm font-semibold leading-none ${
                      isToday
                        ? 'w-6 h-6 flex items-center justify-center rounded-full bg-[#4F46E5] text-white text-xs'
                        : isSunday
                        ? 'text-[#9CA3AF]'
                        : 'text-[#09090B]'
                    }`}
                  >
                    {d.getDate()}
                  </span>
                  <span
                    className={`text-[10px] mt-0.5 ${
                      isSunday ? 'text-[#9CA3AF]' : 'text-[#71717A]'
                    }`}
                  >
                    {SHORT_DAY[d.getDay()]}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as 'weekly' | 'data')}
          className="px-5 pb-5 pt-3 gap-3"
        >
          <TabsList className="gap-1">
            <TabsTrigger value="weekly">Weekly View</TabsTrigger>
            <TabsTrigger value="data">Data View</TabsTrigger>
          </TabsList>

          <TabsContent value="weekly">
            <WeeklyView
              weekStart={weekStart}
              monthEntries={monthEntries}
              today={today}
              onPrevWeek={() => setWeekStart(d => addDays(d, -7))}
              onNextWeek={() => setWeekStart(d => addDays(d, 7))}
              onAddRecord={openAddModal}
              onEdit={openEditModal}
              onDelete={handleDelete}
            />
          </TabsContent>

          <TabsContent value="data">
            <div className="space-y-3">
              <div className="flex justify-end">
                <Button
                  onClick={() => openAddModal()}
                  className="h-9 px-4 text-sm font-medium bg-[#09090B] hover:bg-[#1a1a1a] text-white rounded-lg gap-1.5"
                >
                  <Plus className="h-4 w-4" />
                  Add record
                </Button>
              </div>
              <DataTable
                columns={dataColumns}
                data={dataEntries}
                totalCount={totalCount}
                page={page}
                pageSize={pageSize}
                onPageChange={(p) => updateParams({ page: p })}
                onPageSizeChange={(s) => updateParams({ pageSize: s, page: 1 })}
                onEdit={openEditModal}
                onDelete={handleDelete}
                canEdit={(entry) => entry.is_editable}
                isLoading={dataLoading}
                height="h-auto min-h-[200px]"
              />
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Modal */}
      <EntryModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingEntry(null);
          setModalDate('');
          setModalError('');
        }}
        onSave={handleSave}
        entry={editingEntry}
        initialDate={modalDate}
        error={modalError}
      />
    </div>
  );
}

// ─── Entry Modal ─────────────────────────────────────────────────────────────

function EntryModal({
  isOpen,
  onClose,
  onSave,
  entry,
  initialDate,
  error,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: Partial<GeneralNewEntry>) => void;
  entry: GeneralNewEntry | null;
  initialDate: string;
  error: string;
}) {
  const [formData, setFormData] = useState({
    date: '',
    quotations: '',
    quotes_revised: '',
    quotes_converted: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (entry) {
      setFormData({
        date: entry.date,
        quotations: String(entry.quotations),
        quotes_revised: String(entry.quotes_revised),
        quotes_converted: String(entry.quotes_converted),
      });
    } else {
      setFormData({
        date: initialDate || new Date().toISOString().split('T')[0],
        quotations: '',
        quotes_revised: '',
        quotes_converted: '',
      });
    }
  }, [entry, isOpen, initialDate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    await onSave({
      date: formData.date,
      quotations: Number(formData.quotations),
      quotes_revised: Number(formData.quotes_revised),
      quotes_converted: Number(formData.quotes_converted),
    });
    setIsSubmitting(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="p-0 gap-0">
        <DialogHeader className="border-b border-[#E4E4E4] px-5 py-4">
          <DialogTitle className="text-base font-semibold text-[#09090B]">
            {entry ? 'Edit Entry' : 'Add New Entry'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}
          <FormDatePicker
            label="Date"
            value={formData.date}
            onChange={(date) => setFormData({ ...formData, date })}
            required
          />
          <div className="space-y-2">
            <Label className="text-sm font-medium text-[#374151]">Quotations</Label>
            <Input
              type="number"
              min="0"
              placeholder="0"
              value={formData.quotations}
              onChange={(e) => setFormData({ ...formData, quotations: e.target.value })}
              required
            />
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-medium text-[#374151]">Quotes Revised</Label>
            <Input
              type="number"
              min="0"
              placeholder="0"
              value={formData.quotes_revised}
              onChange={(e) => setFormData({ ...formData, quotes_revised: e.target.value })}
              required
            />
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-medium text-[#374151]">Quotes Converted</Label>
            <Input
              type="number"
              min="0"
              placeholder="0"
              value={formData.quotes_converted}
              onChange={(e) => setFormData({ ...formData, quotes_converted: e.target.value })}
              required
            />
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="rounded-lg">
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="bg-[#09090B] hover:bg-[#1a1a1a] text-white rounded-lg"
            >
              {isSubmitting ? 'Saving…' : entry ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
