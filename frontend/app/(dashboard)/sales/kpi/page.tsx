'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DataTable, Tooltip } from '@/app/components/DataTable';
import { fetchApi, getUsersForModule } from '@/app/lib/api';
import { useAuth } from '@/app/context/AuthContext';
import {
  Plus,
  Info,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Pencil,
  Calendar,
  X,
  Check,
  Users,
  MoreHorizontal,
} from 'lucide-react';
import { DateRangeFilter } from '@/components/ui/date-range-filter';
import { FormDatePicker } from '@/components/ui/form-date-picker';
import { formatDate, formatDateTime } from '@/app/lib/date';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { useConfirm } from '@/app/components/ConfirmDialog';
import { AddedByCell } from '@/app/components/KpiModulePage';

interface SalesKPIEntry {
  id: number;
  date: string;
  leads_to_ops_team: number;
  quotes_from_ops_team: number;
  quotes_to_client: number;
  total_conversions: number;
  new_clients_acquired: number;
  existing_clients: number;
  existing_clients_closed: number;
  gross_booked_premium: number;
  added_by: number;
  added_by_name: string;
  on_behalf_of: number | null;
  on_behalf_of_name: string | null;
  added_at: string;
  is_editable: boolean;
}

interface SalesMonthlyTarget {
  id?: number;
  user?: number;
  year: number;
  month: number;
  premium_target: string | null;
  clients_assigned: number | null;
}

interface ModuleUser {
  id: number;
  email: string;
  full_name: string;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const SHORT_DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thur', 'Fri', 'Sat', 'Sun'];

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

function formatPremium(val: number | null | undefined): string {
  if (val == null) return '0';
  return Math.round(Number(val)).toLocaleString('en-IN');
}

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

// ─── User Avatar ──────────────────────────────────────────────────────────────

function UserAvatar({ name, size = 'sm' }: { name: string; size?: 'sm' | 'md' }) {
  const dim = size === 'sm' ? 'w-7 h-7 text-xs' : 'w-8 h-8 text-sm';
  return (
    <span
      className={`${dim} rounded-full bg-[#6366F1] text-white flex items-center justify-center font-semibold uppercase shrink-0`}
    >
      {name.charAt(0)}
    </span>
  );
}

// ─── Personal Daily Tracker ───────────────────────────────────────────────────

function PersonalDailyTracker({
  calYear,
  calMonth,
  today,
  monthEntries,
  currentUserId,
  userFullName,
  onPrevMonth,
  onNextMonth,
  onGoToday,
}: {
  calYear: number;
  calMonth: number;
  today: Date;
  monthEntries: SalesKPIEntry[];
  currentUserId: number | undefined;
  userFullName: string;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onGoToday: () => void;
}) {
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const trackerTitle = userFullName ? `${userFullName}'s Daily Tracker` : 'Daily Tracker';

  return (
    <div className="bg-white rounded-2xl border border-[#E4E4E4] shadow-sm overflow-hidden">
      {/* Card header */}
      <div className="flex items-center gap-2 px-5 py-2.5 border-b border-[#E4E4E4]">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-[#6366F1]">
          <rect x="1" y="2" width="14" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M1 6h14" stroke="currentColor" strokeWidth="1.5" />
          <path d="M5 1v2M11 1v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span className="text-sm font-semibold text-[#09090B]">{trackerTitle}</span>
      </div>

      {/* Controls row */}
      <div className="flex items-center justify-between px-5 py-2 border-b border-[#E4E4E4]">
        <div className="flex items-center gap-3">
          {/* Month/Year toggle */}
          <div className="flex items-center rounded-lg border border-[#E4E4E4] overflow-hidden text-xs font-medium">
            <button className="px-3 py-1.5 bg-white text-[#09090B]">Month</button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[#09090B] min-w-[120px]">
            {MONTH_NAMES[calMonth]} {calYear}
          </span>
          <button
            onClick={onGoToday}
            className="text-sm font-medium text-[#09090B] px-3 py-1 rounded-lg border border-[#E4E4E4] hover:bg-[#F3F3F3] transition-colors"
          >
            Today
          </button>
          <button
            onClick={onPrevMonth}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[#F3F3F3] transition-colors"
          >
            <ChevronLeft className="h-4 w-4 text-[#71717A]" />
          </button>
          <button
            onClick={onNextMonth}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[#F3F3F3] transition-colors"
          >
            <ChevronRight className="h-4 w-4 text-[#71717A]" />
          </button>
        </div>
      </div>

      {/* Day columns strip */}
      <div className="px-4 py-2.5 overflow-x-auto">
        <div className="flex w-full border border-[#E4E4E4] rounded-lg overflow-hidden">
          {Array.from({ length: daysInMonth }, (_, i) => new Date(calYear, calMonth, i + 1)).map((d, i) => {
            const ds = toLocalDateString(d);
            const isSunday = d.getDay() === 0;
            const isToday = sameDay(d, today);
            const isPast = d < today && !isToday;
            const hasEntry = monthEntries.some((e) => e.date === ds && e.added_by === currentUserId);

            let indicatorBg = '';
            let indicatorStyle: React.CSSProperties | undefined;
            if (isSunday) {
              indicatorStyle = {
                backgroundImage: 'repeating-linear-gradient(135deg,#D1D5DB 0,#D1D5DB 1px,transparent 1px,transparent 6px)',
                backgroundColor: '#F9FAFB',
              };
            } else if (hasEntry) {
              indicatorBg = 'bg-[#DCFCE7]';
            } else if (isToday) {
              indicatorBg = 'bg-[#EEF2FF]';
            } else if (isPast) {
              indicatorBg = 'bg-[#FEE2E2]';
            }

            return (
              <div
                key={d.getDate()}
                className={`flex-1 flex flex-col items-center select-none ${i > 0 ? 'border-l border-[#E4E4E4]' : ''}`}
              >
                {/* Day number + abbreviation */}
                <div className="flex flex-col items-center justify-center h-16 w-full">
                  <span className={`text-[11px] font-semibold leading-none ${
                    isToday
                      ? 'w-[22px] h-[22px] flex items-center justify-center rounded-full bg-[#4F46E5] text-white text-[11px]'
                      : isSunday
                      ? 'text-[#9CA3AF]'
                      : 'text-[#09090B]'
                  }`}>
                    {d.getDate()}
                  </span>
                  <span className={`text-[9px] mt-0.5 leading-none ${isSunday ? 'text-[#9CA3AF]' : 'text-[#71717A]'}`}>
                    {SHORT_DAY[d.getDay()]}
                  </span>
                </div>
                {/* Colored indicator */}
                <div
                  className={`w-full h-16 border-t border-[#E4E4E4] ${indicatorBg}`}
                  style={indicatorStyle}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Tracker View (admin matrix) ──────────────────────────────────────────────

function TrackerView({
  calYear,
  calMonth,
  monthEntries,
  moduleUsers,
  trackerUserFilter,
  onTrackerUserFilterChange,
  onPrevMonth,
  onNextMonth,
  onGoToday,
}: {
  calYear: number;
  calMonth: number;
  monthEntries: SalesKPIEntry[];
  moduleUsers: ModuleUser[];
  trackerUserFilter: string;
  onTrackerUserFilterChange: (v: string) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onGoToday: () => void;
}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const calDays: Date[] = Array.from(
    { length: daysInMonth },
    (_, i) => new Date(calYear, calMonth, i + 1)
  );

  const entryMap = new Map<string, Set<number>>();
  for (const e of monthEntries) {
    if (!entryMap.has(e.date)) entryMap.set(e.date, new Set());
    entryMap.get(e.date)!.add(e.added_by);
  }

  const visibleUsers =
    trackerUserFilter === 'all'
      ? moduleUsers
      : moduleUsers.filter((u) => String(u.id) === trackerUserFilter);

  return (
    <div className="bg-white rounded-2xl border border-[#E4E4E4] shadow-sm overflow-hidden">
      {/* Card header */}
      <div className="flex items-center gap-2 px-5 py-2.5 border-b border-[#E4E4E4]">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-[#6366F1]">
          <rect x="1" y="2" width="14" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M1 6h14" stroke="currentColor" strokeWidth="1.5" />
          <path d="M5 1v2M11 1v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span className="text-sm font-semibold text-[#09090B]">Team Daily Tracker</span>
      </div>

      {/* Controls row */}
      <div className="bg-white flex items-center justify-between px-5 py-2 border-b border-[#E4E4E4] flex-wrap gap-3">
        <div className="flex items-center gap-3">
          {/* Month toggle */}
          <div className="flex items-center rounded-lg border border-[#E4E4E4] overflow-hidden text-xs font-medium">
            <button className="px-3 py-1.5 bg-white text-[#09090B]">
              Month
            </button>
          </div>

          {/* All Users dropdown */}
          <Select value={trackerUserFilter} onValueChange={onTrackerUserFilterChange}>
            <SelectTrigger className="h-8 text-sm border-[#E4E4E4] rounded-lg px-3 gap-1.5 w-auto min-w-[120px]">
              <Users className="h-3.5 w-3.5 text-[#71717A]" />
              <SelectValue placeholder="All Users" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Users</SelectItem>
              {moduleUsers.map((u) => (
                <SelectItem key={u.id} value={String(u.id)}>
                  {u.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[#09090B] min-w-[120px]">
            {MONTH_NAMES[calMonth]} {calYear}
          </span>
          <button
            onClick={onGoToday}
            className="text-sm font-medium text-[#09090B] px-3 py-1 rounded-lg border border-[#E4E4E4] hover:bg-[#F3F3F3] transition-colors"
          >
            Today
          </button>
          <button
            onClick={onPrevMonth}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[#F3F3F3] transition-colors"
          >
            <ChevronLeft className="h-4 w-4 text-[#71717A]" />
          </button>
          <button
            onClick={onNextMonth}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[#F3F3F3] transition-colors"
          >
            <ChevronRight className="h-4 w-4 text-[#71717A]" />
          </button>
        </div>
      </div>

      {/* Grid — scrollable independently so sticky thead works */}
      <div className="overflow-auto max-h-[calc(100vh-15rem)] scrollbar-hide">
        <table className="border-collapse w-full min-w-max">
          <thead className="sticky top-0 z-20">
            <tr className="border-b border-[#E4E4E4]">
              {/* Dept header spanning user column */}
              <th className="sticky left-0 z-30 bg-[#F9F9F9] px-4 py-3 text-left min-w-[180px] border-r border-[#E4E4E4]">
                <div className="text-sm font-semibold text-[#09090B]">Sales KPI DEPT.</div>
                <div className="text-xs text-[#71717A]">{visibleUsers.length} members</div>
              </th>
              {calDays.map((d) => {
                const isSun = d.getDay() === 0;
                const isToday = sameDay(d, today);
                return (
                  <th
                    key={d.getDate()}
                    className={`px-1 py-2 text-center min-w-[36px] border-l border-[#E4E4E4] ${
                      isToday ? 'bg-[#EEF2FF]' : 'bg-[#F9F9F9]'
                    }`}
                  >
                    <div className="flex flex-col items-center gap-0.5">
                      <span
                        className={`text-[10px] font-medium ${
                          isSun ? 'text-[#9CA3AF]' : 'text-[#71717A]'
                        }`}
                      >
                        {SHORT_DAY[d.getDay()]}
                      </span>
                      <span
                        className={`text-xs font-semibold leading-none ${
                          isToday
                            ? 'w-5 h-5 flex items-center justify-center rounded-full bg-[#4F46E5] text-white'
                            : isSun
                            ? 'text-[#9CA3AF]'
                            : 'text-[#09090B]'
                        }`}
                      >
                        {d.getDate()}
                      </span>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E4E4E4]">
            {visibleUsers.length === 0 ? (
              <tr>
                <td colSpan={daysInMonth + 1} className="px-4 py-8 text-center text-sm text-[#71717A]">
                  No users found
                </td>
              </tr>
            ) : (
              visibleUsers.map((user) => (
                <tr key={user.id} className="hover:bg-[#FAFAFA] transition-colors">
                  <td className="sticky left-0 z-10 bg-white hover:bg-[#FAFAFA] px-4 py-3 min-w-[180px] border-r border-[#E4E4E4]">
                    <div className="flex items-center gap-2">
                      <UserAvatar name={user.full_name} />
                      <span className="text-sm font-medium text-[#09090B] truncate max-w-[120px]">
                        {user.full_name}
                      </span>
                    </div>
                  </td>
                  {calDays.map((d) => {
                    const ds = toLocalDateString(d);
                    const isSun = d.getDay() === 0;
                    const isToday = sameDay(d, today);
                    const isPast = d < today && !isToday;
                    const hasEntry = entryMap.get(ds)?.has(user.id) ?? false;

                    let cellBg = '';
                    let cellStyle: React.CSSProperties | undefined;

                    if (isSun) {
                      cellStyle = {
                        backgroundImage:
                          'repeating-linear-gradient(135deg,#D1D5DB 0,#D1D5DB 1px,transparent 1px,transparent 6px)',
                        backgroundColor: '#F9FAFB',
                      };
                    } else if (hasEntry) {
                      cellBg = isToday ? 'bg-[#DCFCE7]' : 'bg-[#DCFCE7]';
                    } else if (isToday) {
                      cellBg = 'bg-[#EEF2FF]';
                    } else if (isPast) {
                      cellBg = 'bg-[#FEE2E2]';
                    }

                    return (
                      <td
                        key={d.getDate()}
                        className={`px-1 py-2 border-l border-[#E4E4E4] ${cellBg}`}
                        style={cellStyle}
                      >
                        <div className="w-8 h-8" />
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Weekly View ─────────────────────────────────────────────────────────────

function WeeklyView({
  weekStart,
  monthEntries,
  today,
  onPrevWeek,
  onNextWeek,
  onGoToCurrentWeek,
  onAddRecord,
  onEdit,
  onDelete,
  moduleUsers,
  weeklyUserFilter,
  onWeeklyUserFilterChange,
  isAdmin,
  currentUserId,
  navStickyTop = 'top-16',
  tableMaxHeight = 'calc(100vh - 15rem)',
}: {
  weekStart: Date;
  monthEntries: SalesKPIEntry[];
  today: Date;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onGoToCurrentWeek: () => void;
  onAddRecord: (date: string) => void;
  onEdit: (entry: SalesKPIEntry) => void;
  onDelete: (entry: SalesKPIEntry) => void;
  moduleUsers: ModuleUser[];
  weeklyUserFilter: string;
  onWeeklyUserFilterChange: (v: string) => void;
  isAdmin: boolean;
  currentUserId: number | undefined;
  navStickyTop?: string;
  tableMaxHeight?: string;
}) {
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const getEntriesForDay = (d: Date): SalesKPIEntry[] => {
    const ds = toLocalDateString(d);
    let entries = monthEntries.filter((e) => e.date === ds);
    if (weeklyUserFilter !== 'all') {
      entries = entries.filter((e) => String(e.added_by) === weeklyUserFilter);
    } else if (!isAdmin) {
      entries = entries.filter((e) => e.added_by === currentUserId);
    }
    return entries.sort((a, b) => new Date(b.added_at).getTime() - new Date(a.added_at).getTime());
  };

  const isPastDay = (d: Date) => {
    const s = new Date(d); s.setHours(0, 0, 0, 0);
    const t = new Date(today); t.setHours(0, 0, 0, 0);
    return s < t;
  };

  const weekEndDay = addDays(weekStart, 6);
  const formatShortDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const weekDateRangeLabel =
    weekStart.getFullYear() === weekEndDay.getFullYear()
      ? `${formatShortDate(weekStart)} – ${formatShortDate(weekEndDay)}, ${weekEndDay.getFullYear()}`
      : `${formatShortDate(weekStart)}, ${weekStart.getFullYear()} – ${formatShortDate(weekEndDay)}, ${weekEndDay.getFullYear()}`;

  // Admin can only add records for themselves; viewing another user is read-only.
  const isViewingSelf =
    weeklyUserFilter === 'all' || weeklyUserFilter === String(currentUserId);

  return (
    <div className="bg-white rounded-2xl border border-[#E4E4E4] shadow-sm">
      {/* Sticky week nav bar */}
      <div className={`sticky ${navStickyTop} z-10 bg-white rounded-t-2xl flex items-center justify-between px-5 py-4 border-b border-[#E4E4E4]`}>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Select value={weeklyUserFilter} onValueChange={onWeeklyUserFilterChange}>
              <SelectTrigger className="h-8 text-sm border-[#E4E4E4] rounded-lg px-3 gap-1.5 w-auto min-w-[130px]">
                <Users className="h-3.5 w-3.5 text-[#71717A]" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {moduleUsers.map((u) => (
                  <SelectItem key={u.id} value={String(u.id)}>
                    {u.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[#09090B] min-w-[160px]">{weekDateRangeLabel}</span>
          <button
            onClick={onGoToCurrentWeek}
            className="text-sm font-medium text-[#09090B] px-3 py-1 rounded-lg border border-[#E4E4E4] hover:bg-[#F3F3F3] transition-colors"
          >
            This Week
          </button>
          <button
            onClick={onPrevWeek}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[#F3F3F3] transition-colors"
          >
            <ChevronLeft className="h-4 w-4 text-[#71717A]" />
          </button>
          <button
            onClick={onNextWeek}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[#F3F3F3] transition-colors"
          >
            <ChevronRight className="h-4 w-4 text-[#71717A]" />
          </button>
        </div>
      </div>

      {/* Table — scrollable container so sticky thead works relative to it */}
      <div className="overflow-auto scrollbar-hide" style={{ maxHeight: tableMaxHeight }}>
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#F9F9F9] border-b border-[#E4E4E4]">
              <th className="px-5 py-3 text-left text-xs font-medium text-[#71717A] tracking-wide w-[140px]">
                Day
              </th>
              <th className="px-5 py-3 text-left text-xs font-medium text-[#71717A] tracking-wide">
                New clients
              </th>
              <th className="px-5 py-3 text-left text-xs font-medium text-[#71717A] tracking-wide">
                Conversions
              </th>
              <th className="px-5 py-3 text-left text-xs font-medium text-[#71717A] tracking-wide">
                Premium
              </th>
              <th className="px-5 py-3 text-left text-xs font-medium text-[#71717A] tracking-wide">
                Added by
              </th>
              <th className="px-5 py-3 text-left text-xs font-medium text-[#71717A] tracking-wide w-[180px]">
                Status
              </th>
              <th className="w-12" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F3F3F3]">
            {weekDays.map((d, idx) => {
              const isSun = d.getDay() === 0;
              const isToday = sameDay(d, today);
              const entries = getEntriesForDay(d);
              const past = isPastDay(d);

              if (entries.length === 0) {
                let statusType: 'submitted' | 'not_submitted' | 'upcoming' = 'upcoming';
                if (past && !isSun) statusType = 'not_submitted';

                const canAddToday = isToday && !isSun && isViewingSelf;
                const todayEntryExists = isToday
                  ? monthEntries.some(
                      (e) =>
                        e.date === toLocalDateString(d) &&
                        (weeklyUserFilter === 'all'
                          ? e.added_by === currentUserId
                          : String(e.added_by) === weeklyUserFilter)
                    )
                  : false;

                return (
                  <tr
                    key={toLocalDateString(d)}
                    className={`h-[64px] transition-colors ${
                      isSun
                        ? 'bg-[#FAFAFA] opacity-60'
                        : isToday
                        ? 'bg-[#F5F3FF] hover:bg-[#EEF2FF]'
                        : 'bg-white hover:bg-[#FAFAFA]'
                    }`}
                  >
                    <td className="px-5 py-3">
                      <div className="flex flex-col gap-0.5">
                        {isToday ? (
                          <span className="inline-flex items-center justify-center bg-[#4F46E5] text-white text-xs font-semibold px-2 py-0.5 rounded-md w-fit">
                            {WEEKDAY_NAMES[idx]}
                          </span>
                        ) : (
                          <span className="text-sm font-semibold leading-tight text-[#09090B]">
                            {WEEKDAY_NAMES[idx]}
                          </span>
                        )}
                        <span className="text-xs text-[#9CA3AF] leading-tight">
                          {d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3">{!isSun && <span className="text-[#D1D5DB]">—</span>}</td>
                    <td className="px-5 py-3">{!isSun && <span className="text-[#D1D5DB]">—</span>}</td>
                    <td className="px-5 py-3">{!isSun && <span className="text-[#D1D5DB]">—</span>}</td>
                    <td className="px-5 py-3" />
                    <td className="px-5 py-3">
                      {!isSun && (
                        canAddToday && !todayEntryExists ? (
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
                    </td>
                    <td className="px-3 py-3">
                      {!isSun && isViewingSelf && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="w-8 h-8 flex items-center justify-center rounded-md text-[#9CA3AF] hover:text-[#09090B] hover:bg-[#F3F3F3] transition-colors">
                              <MoreHorizontal className="h-4 w-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-[149px] bg-white border border-[#E4E4E4] rounded-lg p-1 shadow-md">
                            <DropdownMenuItem
                              onClick={() => onAddRecord(toLocalDateString(d))}
                              className="cursor-pointer px-3 py-2 text-sm text-[#09090B] rounded-md"
                            >
                              Add record
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </td>
                  </tr>
                );
              }

              return entries.map((entry, eIdx) => {
                const statusType: 'submitted' | 'not_submitted' | 'upcoming' = 'submitted';

                return (
                  <tr
                    key={`${toLocalDateString(d)}-${entry.id}`}
                    className={`h-[64px] transition-colors ${
                      isSun
                        ? 'bg-[#FAFAFA] opacity-60'
                        : isToday
                        ? 'bg-[#F0FDF4] hover:bg-[#ECFDF5]'
                        : 'bg-white hover:bg-[#FAFAFA]'
                    }`}
                  >
                    {eIdx === 0 ? (
                      <td className="px-5 py-3">
                        <div className="flex flex-col gap-0.5">
                          {isToday ? (
                            <span className="inline-flex items-center justify-center bg-[#4F46E5] text-white text-xs font-semibold px-2 py-0.5 rounded-md w-fit">
                              {WEEKDAY_NAMES[idx]}
                            </span>
                          ) : (
                            <span className="text-sm font-semibold leading-tight text-[#09090B]">
                              {WEEKDAY_NAMES[idx]}
                            </span>
                          )}
                          <span className="text-xs text-[#9CA3AF] leading-tight">
                            {d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </span>
                        </div>
                      </td>
                    ) : (
                      <td className="px-5 py-3" />
                    )}
                    <td className="px-5 py-3 text-sm font-medium text-[#374151]">{entry.new_clients_acquired}</td>
                    <td className="px-5 py-3 text-sm font-medium text-[#374151]">{entry.total_conversions}</td>
                    <td className="px-5 py-3 text-sm font-medium text-[#374151]">{formatPremium(entry.gross_booked_premium)}</td>
                    <td className="px-5 py-3">
                      <AddedByCell entry={entry} />
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge type={statusType} />
                    </td>
                    <td className="px-3 py-3">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="w-8 h-8 flex items-center justify-center rounded-md text-[#9CA3AF] hover:text-[#09090B] hover:bg-[#F3F3F3] transition-colors">
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-[149px] bg-white border border-[#E4E4E4] rounded-lg p-1 shadow-md">
                          {entry.is_editable && (
                            <DropdownMenuItem
                              onClick={() => onEdit(entry)}
                              className="cursor-pointer px-3 py-2 text-sm text-[#09090B] rounded-md"
                            >
                              Edit
                            </DropdownMenuItem>
                          )}
                          {entry.added_by === currentUserId && (
                            <DropdownMenuItem
                              onClick={() => onDelete(entry)}
                              className="cursor-pointer px-3 py-2 text-sm text-red-600 rounded-md"
                            >
                              Delete
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              });
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Data View columns ───────────────────────────────────────────────────────

const dataColumns = [
  { key: 'date', header: 'Record Date', render: (item: SalesKPIEntry) => formatDate(item.date) },
  {
    key: 'leads_to_ops_team',
    header: 'Leads Ops Team',
    tooltip: 'Number of leads handed over to the operations team',
  },
  {
    key: 'quotes_from_ops_team',
    header: 'Quotes Ops Team',
    tooltip: 'Number of quotes received from the operations team',
  },
  {
    key: 'quotes_to_client',
    header: 'Quotes to Client',
    tooltip: 'Number of quotes submitted to the client',
  },
  {
    key: 'total_conversions',
    header: 'Conversions',
    tooltip: 'Total number of conversions',
  },
  {
    key: 'new_clients_acquired',
    header: 'New Clients',
    tooltip: 'Number of new clients acquired',
  },
  {
    key: 'existing_clients',
    header: 'Existing Clients',
    tooltip: 'Number of existing clients under my account',
  },
  {
    key: 'existing_clients_closed',
    header: 'Existing Clients Closed',
    tooltip: 'How many existing clients did I close',
  },
  {
    key: 'gross_booked_premium',
    header: 'Gross Booked Premium',
    render: (item: SalesKPIEntry) => formatPremium(item.gross_booked_premium),
  },
  { key: 'added_by_name', header: 'Added By', render: (item: SalesKPIEntry) => <AddedByCell entry={item} /> },
  {
    key: 'added_at',
    header: 'Added On',
    render: (item: SalesKPIEntry) => formatDateTime(item.added_at),
  },
];

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function SalesKPIPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { canSeeAllData, user } = useAuth();
  const confirm = useConfirm();

  const isAdmin = canSeeAllData();
  const currentUserId = user?.id;

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const [activeView, setActiveView] = useState<'tracker' | 'weekly' | 'data'>('weekly');

  // Calendar / tracker state
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const [trackerUserFilter, setTrackerUserFilter] = useState('all');

  // Weekly state
  const [weekStart, setWeekStart] = useState<Date>(startOfWeek(today));
  const [weeklyUserFilter, setWeeklyUserFilter] = useState('all');

  // Shared monthly data pool (used by Tracker + Weekly + Data)
  const [monthEntries, setMonthEntries] = useState<SalesKPIEntry[]>([]);
  const [moduleUsers, setModuleUsers] = useState<ModuleUser[]>([]);

  // Data tab state (URL-synced filters)
  const [entries, setEntries] = useState<SalesKPIEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<SalesKPIEntry | null>(null);
  const [modalInitialDate, setModalInitialDate] = useState('');
  const [error, setError] = useState('');

  // Target state
  const [currentTarget, setCurrentTarget] = useState<SalesMonthlyTarget | null>(null);
  const [currentTargetLoaded, setCurrentTargetLoaded] = useState(false);
  const [isTargetModalOpen, setIsTargetModalOpen] = useState(false);

  // Monthly target card navigation
  const [cardYear, setCardYear] = useState(today.getFullYear());
  const [cardMonth, setCardMonth] = useState(today.getMonth() + 1); // 1-indexed
  const [cardTarget, setCardTarget] = useState<SalesMonthlyTarget | null>(null);
  const [cardEntries, setCardEntries] = useState<SalesKPIEntry[]>([]);

  // Panel state
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [sheetYear, setSheetYear] = useState(today.getFullYear());
  const [sheetTargets, setSheetTargets] = useState<SalesMonthlyTarget[]>([]);
  const [sheetInlineValues, setSheetInlineValues] = useState<Record<string, string>>({});
  const [sheetEditingKey, setSheetEditingKey] = useState<string | null>(null);

  const page = Number(searchParams.get('page')) || 1;
  const pageSize = Number(searchParams.get('pageSize')) || 20;
  const dateFrom = searchParams.get('dateFrom') || '';
  const dateTo = searchParams.get('dateTo') || '';
  const userId = searchParams.get('userId') || '';

  const updateFilters = (updates: Record<string, string | number>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (value) {
        params.set(key, String(value));
      } else {
        params.delete(key);
      }
    });
    router.push(`?${params.toString()}`);
  };

  const fetchCurrentTarget = useCallback(async () => {
    const year = today.getFullYear();
    const month = today.getMonth() + 1;
    const result = await fetchApi<{ results: SalesMonthlyTarget[] }>(
      `/api/entries/sales-kpi/monthly-targets/?year=${year}&month=${month}`
    );
    setCurrentTarget(result.data?.results?.[0] ?? null);
    setCurrentTargetLoaded(true);
  }, [today]);

  const fetchCardData = useCallback(async () => {
    const targetResult = await fetchApi<{ results: SalesMonthlyTarget[] }>(
      `/api/entries/sales-kpi/monthly-targets/?year=${cardYear}&month=${cardMonth}`
    );
    setCardTarget(targetResult.data?.results?.[0] ?? null);

    // Fetch entries for card month
    const firstDay = `${cardYear}-${String(cardMonth).padStart(2, '0')}-01`;
    const lastDay = toLocalDateString(new Date(cardYear, cardMonth, 0));
    const result = await fetchApi<{ results: SalesKPIEntry[] }>(
      `/api/entries/sales-kpi/?date_from=${firstDay}&date_to=${lastDay}&page_size=1000`
    );
    setCardEntries(result.data?.results ?? []);
  }, [cardYear, cardMonth]);

  const fetchEntries = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('page_size', String(pageSize));
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      if (userId) params.set('user_id', userId);

      const result = await fetchApi<{ results: SalesKPIEntry[]; count: number }>(
        `/api/entries/sales-kpi/?${params}`
      );
      setEntries(result.data?.results || []);
      setTotalCount(result.data?.count || 0);
    } catch (err) {
      console.error('Failed to fetch entries:', err);
    }
    setIsLoading(false);
  }, [page, pageSize, dateFrom, dateTo, userId]);

  const fetchMonthEntries = useCallback(async (year: number, month: number) => {
    try {
      const firstDay = `${year}-${String(month + 1).padStart(2, '0')}-01`;
      const lastDay = toLocalDateString(new Date(year, month + 1, 0));
      const params = new URLSearchParams({
        date_from: firstDay,
        date_to: lastDay,
        page_size: '1000',
      });
      const result = await fetchApi<{ results: SalesKPIEntry[] }>(
        `/api/entries/sales-kpi/?${params}`
      );
      setMonthEntries(result.data?.results ?? []);
    } catch {
      setMonthEntries([]);
    }
  }, []);

  const fetchSheetTargets = useCallback(async () => {
    const result = await fetchApi<{ results: SalesMonthlyTarget[] }>(
      `/api/entries/sales-kpi/monthly-targets/?year=${sheetYear}`
    );
    setSheetTargets(result.data?.results ?? []);
  }, [sheetYear]);

  // Load module users for admin (used by Tracker, Weekly, and Data user filters)
  useEffect(() => {
    if (!isAdmin) return;
    getUsersForModule('sales_kpi').then((result) => {
      if (result.data) {
        setModuleUsers(result.data);
        if (result.data.length > 0) {
          setWeeklyUserFilter(String(result.data[0].id));
        }
      }
    });
  }, [isAdmin]);

  useEffect(() => {
    fetchCurrentTarget();
  }, [fetchCurrentTarget]);

  useEffect(() => {
    if (currentTargetLoaded) fetchCardData();
  }, [cardYear, cardMonth, currentTargetLoaded, fetchCardData]);

  useEffect(() => {
    fetchMonthEntries(calYear, calMonth);
  }, [calYear, calMonth, fetchMonthEntries]);

  // Re-fetch when week navigation crosses the calendar month boundary
  useEffect(() => {
    const weekEndDay = addDays(weekStart, 6);
    if (weekStart.getMonth() !== calMonth || weekStart.getFullYear() !== calYear) {
      fetchMonthEntries(weekStart.getFullYear(), weekStart.getMonth());
    } else if (weekEndDay.getMonth() !== calMonth) {
      fetchMonthEntries(weekEndDay.getFullYear(), weekEndDay.getMonth());
    }
  }, [weekStart, calYear, calMonth, fetchMonthEntries]);

  useEffect(() => {
    if (activeView === 'data') fetchEntries();
  }, [activeView, fetchEntries]);

  useEffect(() => {
    if (isPanelOpen) fetchSheetTargets();
  }, [isPanelOpen, sheetYear, fetchSheetTargets]);

  const refreshAll = () => {
    if (activeView === 'data') fetchEntries();
    fetchCardData();
    fetchMonthEntries(calYear, calMonth);
  };

  const handleSaveEntry = async (formData: Partial<SalesKPIEntry>) => {
    setError('');
    const endpoint = editingEntry
      ? `/api/entries/sales-kpi/${editingEntry.id}/`
      : `/api/entries/sales-kpi/`;

    const result = await fetchApi<SalesKPIEntry>(endpoint, {
      method: editingEntry ? 'PATCH' : 'POST',
      body: JSON.stringify(formData),
    });

    if (result.data) {
      setIsModalOpen(false);
      setEditingEntry(null);
      setModalInitialDate('');
      refreshAll();
    } else {
      setError(result.error || 'Failed to save entry');
    }
  };

  const handleDeleteEntry = async (entry: SalesKPIEntry) => {
    const ok = await confirm({
      title: 'Delete entry?',
      description: 'This action cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    const result = await fetchApi<void>(`/api/entries/sales-kpi/${entry.id}/`, { method: 'DELETE' });
    if (!result.error) {
      toast.success('Entry deleted');
      refreshAll();
    } else {
      toast.error(result.error || 'Failed to delete entry');
    }
  };

  // Card actuals (monthly target progress)
  const cardPremiumActual = cardEntries.reduce(
    (sum, e) => sum + Number(e.gross_booked_premium),
    0
  );
  const cardClientsActual = cardEntries.reduce((sum, e) => sum + e.new_clients_acquired, 0);
  const premiumTarget = cardTarget?.premium_target != null ? Number(cardTarget.premium_target) : null;
  const clientsTarget = cardTarget?.clients_assigned ?? null;

  const TARGET_MULTIPLIER = 1.5;
  const premiumMax = premiumTarget ? premiumTarget * TARGET_MULTIPLIER : 0;
  const clientsMax = clientsTarget ? clientsTarget * TARGET_MULTIPLIER : 0;
  const premiumPct = premiumMax ? Math.min(100, (cardPremiumActual / premiumMax) * 100) : 0;
  const clientsPct = clientsMax ? Math.min(100, (cardClientsActual / clientsMax) * 100) : 0;
  const premiumMarkerPct = premiumMax ? (premiumTarget! / premiumMax) * 100 : 0;
  const clientsMarkerPct = clientsMax ? (clientsTarget! / clientsMax) * 100 : 0;

  const isCurrentMonthCard =
    cardYear === today.getFullYear() && cardMonth === today.getMonth() + 1;

  const noCurrentTarget = currentTargetLoaded && !currentTarget;

  useEffect(() => {
    if (noCurrentTarget) setIsTargetModalOpen(true);
  }, [noCurrentTarget]);

  // Determine which target to edit in the modal (card month's target)
  const targetForModal: SalesMonthlyTarget | null = isCurrentMonthCard
    ? currentTarget
    : cardTarget;

  // Sheet helpers
  const getSheetTarget = (month: number) =>
    sheetTargets.find((t) => t.month === month) ?? null;

  const sheetInlineKey = (tab: string, month: number) => `${tab}-${month}`;

  const handleSheetInlineSave = async (tab: string, month: number) => {
    const key = sheetInlineKey(tab, month);
    const val = sheetInlineValues[key];
    if (val === '' || val === undefined) {
      setSheetEditingKey(null);
      return;
    }
    if (Number(val) <= 0) {
      toast.error(
        tab === 'premium'
          ? 'Premium target must be greater than 0'
          : 'Assigned clients must be greater than 0'
      );
      return;
    }
    const existing = getSheetTarget(month);
    const body: Record<string, number | null> =
      tab === 'premium'
        ? { premium_target: Number(val) }
        : { clients_assigned: Number(val) };

    if (existing?.id) {
      await fetchApi(`/api/entries/sales-kpi/monthly-targets/${existing.id}/`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
    } else {
      await fetchApi('/api/entries/sales-kpi/monthly-targets/', {
        method: 'POST',
        body: JSON.stringify({ year: sheetYear, month, ...body }),
      });
    }
    setSheetEditingKey(null);
    setSheetInlineValues((prev) => ({ ...prev, [key]: '' }));
    fetchSheetTargets();
    if (isCurrentMonthCard || (sheetYear === today.getFullYear() && month === today.getMonth() + 1)) {
      fetchCurrentTarget();
    }
  };

  // Calendar navigation handlers
  const prevMonth = () => {
    if (calMonth === 0) {
      setCalYear((y) => y - 1);
      setCalMonth(11);
    } else {
      setCalMonth((m) => m - 1);
    }
  };
  const nextMonth = () => {
    if (calMonth === 11) {
      setCalYear((y) => y + 1);
      setCalMonth(0);
    } else {
      setCalMonth((m) => m + 1);
    }
  };
  const goToday = () => {
    setCalYear(today.getFullYear());
    setCalMonth(today.getMonth());
  };

  const openAddModal = (date?: string) => {
    if (noCurrentTarget) {
      setIsTargetModalOpen(true);
      return;
    }
    setEditingEntry(null);
    setError('');
    setModalInitialDate(date || toLocalDateString(today));
    setIsModalOpen(true);
  };

  const openEditModal = (entry: SalesKPIEntry) => {
    setEditingEntry(entry);
    setError('');
    setModalInitialDate('');
    setIsModalOpen(true);
  };

  const onWeeklyAdd = (dateStr: string) => {
    openAddModal(dateStr);
  };

  return (
    <div className="p-6 flex gap-6 items-start">
      <div className="flex-1 min-w-0 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Sales KPI</h1>
            <p className="text-muted-foreground">Manage sales KPI entries</p>
          </div>
          <Button variant="outline" onClick={() => setIsPanelOpen((o) => !o)}>
            <Pencil className="h-4 w-4 mr-2" />
            Monthly Targets
          </Button>
        </div>

        {/* Monthly Target + Daily Tracker row */}
        <div className="flex gap-5 items-stretch flex-wrap">
          {/* Monthly Target Card */}
          <div className="border rounded-lg p-4 space-y-2 bg-white w-[362px] shrink-0 flex flex-col">
            <h2 className="text-base font-semibold">Monthly Target</h2>
            <div className="grid grid-cols-2 gap-6">
              {/* Premium */}
              <div className="space-y-1">
                <div className="flex items-baseline justify-between">
                  <span className="text-xl font-bold">{formatPremium(cardPremiumActual)}</span>
                  <span className="text-sm text-muted-foreground">Premium</span>
                </div>
                <div className="relative">
                  <div className={premiumTarget !== null && cardPremiumActual >= premiumTarget ? '[&_[data-slot=progress-indicator]]:bg-green-500' : '[&_[data-slot=progress-indicator]]:bg-red-400'}>
                    <Progress value={premiumPct} className="h-2 bg-gray-100" />
                  </div>
                  {premiumTarget !== null && (
                    <div
                      className="absolute top-0 h-2 w-0.5 bg-gray-400 rounded-full"
                      style={{ left: `${premiumMarkerPct}%` }}
                    />
                  )}
                </div>
                <div className="relative">
                  <span className="text-xs text-muted-foreground">0</span>
                  {premiumTarget !== null && (
                    <div
                      className="absolute top-0 -translate-x-1/2 flex flex-col items-center text-xs"
                      style={{ left: `${premiumMarkerPct}%` }}
                    >
                      <span className="text-blue-500 leading-none">▲</span>
                      <span className="text-muted-foreground">{formatPremium(premiumTarget)}</span>
                    </div>
                  )}
                </div>
              </div>
              {/* Client Retention */}
              <div className="space-y-1">
                <div className="flex items-baseline justify-between">
                  <span className="text-xl font-bold">{cardClientsActual.toLocaleString()}</span>
                  <span className="text-sm text-muted-foreground">Client Retention</span>
                </div>
                <div className="relative">
                  <div className={clientsTarget !== null && cardClientsActual >= clientsTarget ? '[&_[data-slot=progress-indicator]]:bg-green-500' : '[&_[data-slot=progress-indicator]]:bg-red-400'}>
                    <Progress value={clientsPct} className="h-2 bg-gray-100" />
                  </div>
                  {clientsTarget !== null && (
                    <div
                      className="absolute top-0 h-2 w-0.5 bg-gray-400 rounded-full"
                      style={{ left: `${clientsMarkerPct}%` }}
                    />
                  )}
                </div>
                <div className="relative">
                  <span className="text-xs text-muted-foreground">0</span>
                  {clientsTarget !== null && (
                    <div
                      className="absolute top-0 -translate-x-1/2 flex flex-col items-center text-xs"
                      style={{ left: `${clientsMarkerPct}%` }}
                    >
                      <span className="text-blue-500 leading-none">▲</span>
                      <span className="text-muted-foreground">{Math.round(clientsTarget).toLocaleString()}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
            {/* Month heading */}
            <h3 className="text-xl font-semibold">{MONTH_NAMES[cardMonth - 1]}</h3>
            {/* Navigation */}
            <div className="flex items-center gap-2 mt-auto">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    if (cardMonth === 1) { setCardMonth(12); setCardYear((y) => y - 1); }
                    else { setCardMonth((m) => m - 1); }
                  }}
                  className="p-1 border border-[#E4E4E4] rounded hover:bg-accent"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  onClick={() => {
                    if (cardMonth === 12) { setCardMonth(1); setCardYear((y) => y + 1); }
                    else { setCardMonth((m) => m + 1); }
                  }}
                  className="p-1 border border-[#E4E4E4] rounded hover:bg-accent"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setCardYear(today.getFullYear()); setCardMonth(today.getMonth() + 1); }}
              >
                <Calendar className="h-3 w-3 mr-1" />
                Today
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
                onClick={() => setIsTargetModalOpen(true)}
              >
                <Pencil className="h-3 w-3 mr-1" />
                Edit
              </Button>
            </div>
          </div>

          {/* Personal Daily Tracker — right of Monthly Target, same line */}
          <div className="flex-1 min-w-[320px]">
            <PersonalDailyTracker
              calYear={calYear}
              calMonth={calMonth}
              today={today}
              monthEntries={monthEntries}
              currentUserId={currentUserId}
              userFullName={user?.full_name || ''}
              onPrevMonth={prevMonth}
              onNextMonth={nextMonth}
              onGoToday={goToday}
            />
          </div>
        </div>

        {/* Tabs */}
        <Tabs
          value={activeView}
          onValueChange={(v) => setActiveView(v as 'tracker' | 'weekly' | 'data')}
          className="gap-0"
        >
          <div className="sticky top-16 z-20 bg-white py-2">
            <TabsList className="bg-[#F3F4F6] rounded-lg p-1 gap-0">
              {isAdmin && (
                <TabsTrigger
                  value="tracker"
                  className="px-4 py-1.5 text-sm font-medium rounded-lg data-[state=active]:bg-white data-[state=active]:text-[#09090B] data-[state=active]:border data-[state=active]:border-[#E4E4E4] data-[state=active]:shadow-none data-[state=inactive]:bg-transparent data-[state=inactive]:text-[#6B7280] data-[state=inactive]:border-transparent"
                >
                  Tracker View
                </TabsTrigger>
              )}
              <TabsTrigger
                value="weekly"
                className="px-4 py-1.5 text-sm font-medium rounded-lg data-[state=active]:bg-white data-[state=active]:text-[#09090B] data-[state=active]:border data-[state=active]:border-[#E4E4E4] data-[state=active]:shadow-none data-[state=inactive]:bg-transparent data-[state=inactive]:text-[#6B7280] data-[state=inactive]:border-transparent"
              >
                Weekly View
              </TabsTrigger>
              <TabsTrigger
                value="data"
                className="px-4 py-1.5 text-sm font-medium rounded-lg data-[state=active]:bg-white data-[state=active]:text-[#09090B] data-[state=active]:border data-[state=active]:border-[#E4E4E4] data-[state=active]:shadow-none data-[state=inactive]:bg-transparent data-[state=inactive]:text-[#6B7280] data-[state=inactive]:border-transparent"
              >
                Data View
              </TabsTrigger>
            </TabsList>
          </div>

          {isAdmin && (
            <TabsContent value="tracker" className="mt-4">
              <TrackerView
                calYear={calYear}
                calMonth={calMonth}
                monthEntries={monthEntries}
                moduleUsers={moduleUsers}
                trackerUserFilter={trackerUserFilter}
                onTrackerUserFilterChange={setTrackerUserFilter}
                onPrevMonth={prevMonth}
                onNextMonth={nextMonth}
                onGoToday={goToday}
              />
            </TabsContent>
          )}

          <TabsContent value="weekly" className="mt-4">
            <WeeklyView
              weekStart={weekStart}
              monthEntries={monthEntries}
              today={today}
              onPrevWeek={() => setWeekStart((d) => addDays(d, -7))}
              onNextWeek={() => setWeekStart((d) => addDays(d, 7))}
              onGoToCurrentWeek={() => setWeekStart(startOfWeek(today))}
              onAddRecord={onWeeklyAdd}
              onEdit={openEditModal}
              onDelete={handleDeleteEntry}
              moduleUsers={moduleUsers}
              weeklyUserFilter={weeklyUserFilter}
              onWeeklyUserFilterChange={setWeeklyUserFilter}
              isAdmin={isAdmin}
              currentUserId={currentUserId}
            />
          </TabsContent>

          <TabsContent value="data" className="mt-4">
            <div className="space-y-4">
              {/* Filters + Add Entry */}
              <div className="flex gap-4 items-end flex-wrap justify-between">
                <div className="flex gap-4 items-end flex-wrap">
                  <div className="flex flex-col gap-2">
                    <Label>Date Range</Label>
                    <DateRangeFilter
                      dateFrom={dateFrom}
                      dateTo={dateTo}
                      onChange={(from, to) => updateFilters({ dateFrom: from, dateTo: to, page: 1 })}
                    />
                  </div>
                  {isAdmin && (
                    <div className="flex flex-col gap-2">
                      <Label>User</Label>
                      <Select
                        value={userId || 'all'}
                        onValueChange={(value) =>
                          updateFilters({ userId: value === 'all' ? '' : value, page: 1 })
                        }
                      >
                        <SelectTrigger className="w-[200px] shadow-none">
                          <SelectValue placeholder="All Users" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Users</SelectItem>
                          {moduleUsers.map((u) => (
                            <SelectItem key={u.id} value={u.id.toString()}>
                              {u.full_name || u.email}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
                {/* TODO: confirm with PM whether to keep configurable. Hidden per Bug 11.
                <Button
                  disabled={noCurrentTarget}
                  title={noCurrentTarget ? 'Set monthly targets first' : undefined}
                  onClick={() => openAddModal()}
                >
                  <Plus className="h-4 w-4 mr-2" /> Add Entry
                </Button>
                */}
              </div>

              <DataTable
                columns={dataColumns}
                data={entries}
                totalCount={totalCount}
                page={page}
                pageSize={pageSize}
                onPageChange={(p) => updateFilters({ page: p })}
                onPageSizeChange={(s) => updateFilters({ pageSize: s, page: 1 })}
                onEdit={openEditModal}
                onDelete={handleDeleteEntry}
                canEdit={(entry) => entry.is_editable}
                canDelete={(entry) => entry.added_by === currentUserId}
                isLoading={isLoading}
              />
            </div>
          </TabsContent>
        </Tabs>

        {/* Entry Modal */}
        <EntryModal
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            setEditingEntry(null);
            setError('');
            setModalInitialDate('');
          }}
          onSave={handleSaveEntry}
          entry={editingEntry}
          initialDate={modalInitialDate}
          error={error}
        />

        {/* Set/Edit Targets Modal */}
        <TargetModal
          isOpen={isTargetModalOpen}
          onClose={() => setIsTargetModalOpen(false)}
          year={isCurrentMonthCard ? today.getFullYear() : cardYear}
          month={isCurrentMonthCard ? today.getMonth() + 1 : cardMonth}
          existing={targetForModal}
          required={noCurrentTarget}
          onSaved={() => {
            fetchCurrentTarget();
            fetchCardData();
          }}
        />
      </div>

      {/* Monthly Targets Panel */}
      {isPanelOpen && (
        <div className="w-[340px] shrink-0 border rounded-lg overflow-hidden bg-white">
          <div className="flex items-start justify-between px-4 py-3 border-b">
            <div>
              <h3 className="font-semibold text-base text-[#09090B]">Monthly Targets</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Calendar year monthly KPI targets
              </p>
            </div>
            <button
              onClick={() => setIsPanelOpen(false)}
              className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-[#09090B]"
              aria-label="Close monthly targets panel"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex items-center justify-between px-4 py-3 border-b bg-[#FAFAFA]">
            <span className="font-semibold text-base text-[#09090B]">{sheetYear}</span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setSheetYear((y) => y - 1)}
                className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-[#E4E4E4] bg-white hover:bg-accent"
                aria-label="Previous year"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => setSheetYear((y) => y + 1)}
                className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-[#E4E4E4] bg-white hover:bg-accent"
                aria-label="Next year"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="px-4 pt-3 pb-1">
            <Tabs defaultValue="premium">
              <TabsList className="bg-[#F3F4F6] rounded-lg p-1 gap-0 mb-2 w-fit">
                <TabsTrigger
                  value="premium"
                  className="px-4 py-1.5 text-sm font-medium rounded-lg data-[state=active]:bg-white data-[state=active]:text-[#09090B] data-[state=active]:border data-[state=active]:border-[#E4E4E4] data-[state=active]:shadow-none data-[state=inactive]:bg-transparent data-[state=inactive]:text-[#6B7280] data-[state=inactive]:border-transparent"
                >
                  Premium
                </TabsTrigger>
                <TabsTrigger
                  value="clients"
                  className="px-4 py-1.5 text-sm font-medium rounded-lg data-[state=active]:bg-white data-[state=active]:text-[#09090B] data-[state=active]:border data-[state=active]:border-[#E4E4E4] data-[state=active]:shadow-none data-[state=inactive]:bg-transparent data-[state=inactive]:text-[#6B7280] data-[state=inactive]:border-transparent"
                >
                  Clients Assigned
                </TabsTrigger>
              </TabsList>
              {(['premium', 'clients'] as const).map((tab) => (
                <TabsContent key={tab} value={tab} className="-mx-4">
                  <div>
                    {MONTH_NAMES.map((name, idx) => {
                      const m = idx + 1;
                      const t = getSheetTarget(m);
                      const val = tab === 'premium' ? t?.premium_target : t?.clients_assigned;
                      const isSet = val !== null && val !== undefined;
                      const key = sheetInlineKey(tab, m);
                      const isEditing = sheetEditingKey === key;

                      const enterEdit = () => {
                        setSheetEditingKey(key);
                        setSheetInlineValues((prev) => ({
                          ...prev,
                          [key]: isSet ? String(val) : '',
                        }));
                      };
                      const cancelEdit = () => {
                        setSheetEditingKey(null);
                        setSheetInlineValues((prev) => {
                          const next = { ...prev };
                          delete next[key];
                          return next;
                        });
                      };

                      if (isEditing) {
                        return (
                          <div
                            key={m}
                            className="px-4 py-3 border-t border-b border-[#F1F1F1] bg-white"
                          >
                            <h4 className="text-sm font-semibold text-[#09090B] mb-3">
                              {name} {sheetYear}
                            </h4>
                            <Label htmlFor={key} className="text-sm">
                              {tab === 'premium' ? 'Premium Target' : 'Clients Assigned'}
                            </Label>
                            <Input
                              id={key}
                              type="number"
                              min="1"
                              autoFocus
                              placeholder={
                                tab === 'premium'
                                  ? 'Enter premium target…'
                                  : 'Enter clients assigned…'
                              }
                              value={sheetInlineValues[key] ?? ''}
                              onChange={(e) =>
                                setSheetInlineValues((prev) => ({
                                  ...prev,
                                  [key]: e.target.value,
                                }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleSheetInlineSave(tab, m);
                                }
                                if (e.key === 'Escape') {
                                  e.preventDefault();
                                  cancelEdit();
                                }
                              }}
                              className="mt-2"
                            />
                            <div className="flex justify-end gap-2 mt-3">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={cancelEdit}
                              >
                                Cancel
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => handleSheetInlineSave(tab, m)}
                              >
                                <Check className="h-4 w-4 mr-1" /> Save
                              </Button>
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div
                          key={m}
                          className="flex items-center justify-between px-4 py-3 border-t border-[#F1F1F1]"
                        >
                          <span className="text-sm text-[#09090B]">{name}</span>
                          {isSet ? (
                            <div className="flex items-center gap-3">
                              <span className="text-sm font-semibold text-[#09090B]">
                                {tab === 'premium' ? formatPremium(Number(val)) : val}
                              </span>
                              <button
                                onClick={enterEdit}
                                className="text-muted-foreground hover:text-[#09090B]"
                                aria-label={`Edit ${name} target`}
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-3">
                              <span className="text-sm italic text-muted-foreground">
                                Not set
                              </span>
                              <button
                                onClick={enterEdit}
                                className="text-muted-foreground hover:text-[#09090B]"
                                aria-label={`Set ${name} target`}
                              >
                                <Plus className="h-4 w-4" />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </TabsContent>
              ))}
            </Tabs>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Entry Modal ──────────────────────────────────────────────────────────────

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
  onSave: (data: Partial<SalesKPIEntry>) => void;
  entry: SalesKPIEntry | null;
  initialDate: string;
  error: string;
}) {
  const [formData, setFormData] = useState({
    date: '',
    leads_to_ops_team: '',
    quotes_from_ops_team: '',
    quotes_to_client: '',
    total_conversions: '',
    new_clients_acquired: '',
    existing_clients: '',
    existing_clients_closed: '',
    gross_booked_premium: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (entry) {
      setFormData({
        date: entry.date,
        leads_to_ops_team: String(entry.leads_to_ops_team),
        quotes_from_ops_team: String(entry.quotes_from_ops_team),
        quotes_to_client: String(entry.quotes_to_client),
        total_conversions: String(entry.total_conversions),
        new_clients_acquired: String(entry.new_clients_acquired),
        existing_clients: String(entry.existing_clients),
        existing_clients_closed: String(entry.existing_clients_closed),
        gross_booked_premium: String(entry.gross_booked_premium),
      });
    } else {
      setFormData({
        date: initialDate || new Date().toISOString().split('T')[0],
        leads_to_ops_team: '',
        quotes_from_ops_team: '',
        quotes_to_client: '',
        total_conversions: '',
        new_clients_acquired: '',
        existing_clients: '',
        existing_clients_closed: '',
        gross_booked_premium: '',
      });
    }
  }, [entry, isOpen, initialDate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    await onSave({
      date: formData.date,
      leads_to_ops_team: Number(formData.leads_to_ops_team),
      quotes_from_ops_team: Number(formData.quotes_from_ops_team),
      quotes_to_client: Number(formData.quotes_to_client),
      total_conversions: Number(formData.total_conversions),
      new_clients_acquired: Number(formData.new_clients_acquired),
      existing_clients: Number(formData.existing_clients),
      existing_clients_closed: Number(formData.existing_clients_closed),
      gross_booked_premium: Number(formData.gross_booked_premium),
    });
    setIsSubmitting(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="p-0">
        <DialogHeader className="border-b border-[#E4E4E4] p-4">
          <DialogTitle>{entry ? 'Edit Entry' : 'Add New Entry'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 p-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md text-sm">
              {error}
            </div>
          )}
          <FormDatePicker
            label="Date"
            value={formData.date}
            onChange={(date) => setFormData({ ...formData, date })}
            required
          />
          <div className="space-y-5">
            {/* New Clients + Premium */}
            <div>
              <h3 className="text-base font-semibold text-[#343434] mb-3">
                Clients &amp; Premium
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="flex items-center gap-1">
                    New Clients Acquired
                    <Tooltip text="Number of new clients acquired">
                      <Info className="h-3 w-3 text-[#71717A] cursor-help" />
                    </Tooltip>
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    placeholder="Enter count"
                    value={formData.new_clients_acquired}
                    onChange={(e) =>
                      setFormData({ ...formData, new_clients_acquired: e.target.value })
                    }
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-1">
                    Gross Booked Premium
                    <Tooltip text="Total gross premium booked today">
                      <Info className="h-3 w-3 text-[#71717A] cursor-help" />
                    </Tooltip>
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="e.g. 5000"
                    value={formData.gross_booked_premium}
                    onChange={(e) =>
                      setFormData({ ...formData, gross_booked_premium: e.target.value })
                    }
                    required
                  />
                </div>
              </div>
            </div>

            {/* Lead to Quote */}
            <div>
              <h3 className="text-base font-semibold text-[#343434] mb-3">Lead to Quote Ratio</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="flex items-center gap-1">
                    Leads to Ops Team
                    <Tooltip text="Number of leads handed over to the operations team">
                      <Info className="h-3 w-3 text-[#71717A] cursor-help" />
                    </Tooltip>
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    placeholder="Enter count"
                    value={formData.leads_to_ops_team}
                    onChange={(e) => setFormData({ ...formData, leads_to_ops_team: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-1">
                    Quotes From Ops Team
                    <Tooltip text="Number of quotes received from the operations team">
                      <Info className="h-3 w-3 text-[#71717A] cursor-help" />
                    </Tooltip>
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    placeholder="Enter count"
                    value={formData.quotes_from_ops_team}
                    onChange={(e) =>
                      setFormData({ ...formData, quotes_from_ops_team: e.target.value })
                    }
                    required
                  />
                </div>
              </div>
            </div>

            {/* Client Retention */}
            <div>
              <h3 className="text-base font-semibold text-[#343434] mb-3">
                Client Retention
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="flex items-center gap-1">
                    Existing Clients
                    <Tooltip text="Number of existing clients under my account">
                      <Info className="h-3 w-3 text-[#71717A] cursor-help" />
                    </Tooltip>
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    placeholder="Enter count"
                    value={formData.existing_clients}
                    onChange={(e) =>
                      setFormData({ ...formData, existing_clients: e.target.value })
                    }
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-1">
                    Existing Clients Closed
                    <Tooltip text="How many existing clients did I close">
                      <Info className="h-3 w-3 text-[#71717A] cursor-help" />
                    </Tooltip>
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    placeholder="Enter count"
                    value={formData.existing_clients_closed}
                    onChange={(e) =>
                      setFormData({ ...formData, existing_clients_closed: e.target.value })
                    }
                    required
                  />
                </div>
              </div>
            </div>

            {/* Quote to Conversion */}
            <div>
              <h3 className="text-base font-semibold text-[#343434] mb-3">
                Quote to Conversion Ratio
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="flex items-center gap-1">
                    Quotes to Client
                    <Tooltip text="Number of quotes submitted to the client">
                      <Info className="h-3 w-3 text-[#71717A] cursor-help" />
                    </Tooltip>
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    placeholder="Enter count"
                    value={formData.quotes_to_client}
                    onChange={(e) =>
                      setFormData({ ...formData, quotes_to_client: e.target.value })
                    }
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-1">
                    Total Conversions
                    <Tooltip text="Total number of conversions">
                      <Info className="h-3 w-3 text-[#71717A] cursor-help" />
                    </Tooltip>
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    placeholder="Enter count"
                    value={formData.total_conversions}
                    onChange={(e) =>
                      setFormData({ ...formData, total_conversions: e.target.value })
                    }
                    required
                  />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : entry ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Target Modal ─────────────────────────────────────────────────────────────

function TargetModal({
  isOpen,
  onClose,
  year,
  month,
  existing,
  required,
  onSaved,
}: {
  isOpen: boolean;
  onClose: () => void;
  year: number;
  month: number;
  existing: SalesMonthlyTarget | null;
  required?: boolean;
  onSaved: () => void;
}) {
  const [premiumTarget, setPremiumTarget] = useState('');
  const [clientsAssigned, setClientsAssigned] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`;
  const isNew = !existing?.id;

  useEffect(() => {
    if (isOpen) {
      setPremiumTarget(existing?.premium_target != null ? String(existing.premium_target) : '');
      setClientsAssigned(existing?.clients_assigned != null ? String(existing.clients_assigned) : '');
      setError('');
    }
  }, [isOpen, existing]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (premiumTarget !== '' && Number(premiumTarget) <= 0) {
      setError('Premium target must be greater than 0');
      return;
    }
    if (clientsAssigned !== '' && Number(clientsAssigned) <= 0) {
      setError('Assigned clients must be greater than 0');
      return;
    }

    setIsSubmitting(true);

    const body: Record<string, number | string> = {};
    if (premiumTarget !== '') body.premium_target = Number(premiumTarget);
    if (clientsAssigned !== '') body.clients_assigned = Number(clientsAssigned);

    let result;
    if (isNew) {
      result = await fetchApi('/api/entries/sales-kpi/monthly-targets/', {
        method: 'POST',
        body: JSON.stringify({ year, month, ...body }),
      });
    } else {
      result = await fetchApi(`/api/entries/sales-kpi/monthly-targets/${existing!.id}/`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
    }

    if (!result.error) {
      onSaved();
      onClose();
    } else {
      setError(result.error || 'Failed to save targets');
    }
    setIsSubmitting(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!required || open) onClose(); }}>
      <DialogContent
        className={`p-0 sm:max-w-sm${required ? ' [&>button]:hidden' : ''}`}
        onInteractOutside={required ? (e) => e.preventDefault() : undefined}
        onEscapeKeyDown={required ? (e) => e.preventDefault() : undefined}
      >
        <DialogHeader className="border-b border-[#E4E4E4] p-4">
          <DialogTitle>
            {isNew ? `Set ${monthLabel} Targets` : `Edit ${monthLabel} Targets`}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">Enter your targets for {monthLabel}.</p>
        </DialogHeader>
        <form onSubmit={handleSave} className="space-y-4 p-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md text-sm">
              {error}
            </div>
          )}
          {isNew && (
            <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
              <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <p className="text-sm text-amber-800">
                <span className="font-semibold">Action required for {monthLabel}</span> — Add your
                premium target and assigned clients to continue using the software.
              </p>
            </div>
          )}

          {/* Premium Target */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label>Premium Target</Label>
              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                {monthLabel}
              </span>
            </div>
            <Input
              type="number"
              min="1"
              step="1"
              placeholder="e.g. 150"
              value={premiumTarget}
              onChange={(e) => setPremiumTarget(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Total premium target for this month</p>
          </div>

          {/* Assigned Clients */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label>Assigned Clients</Label>
              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                {monthLabel}
              </span>
            </div>
            <Input
              type="number"
              min="1"
              placeholder="e.g. 50"
              value={clientsAssigned}
              onChange={(e) => setClientsAssigned(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Total existing clients assigned to you for this month.
            </p>
          </div>

          <DialogFooter>
            {!required && (
              <Button type="button" variant="outline" onClick={onClose}>
                Skip for now
              </Button>
            )}
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : `✓ Save ${MONTH_NAMES[month - 1]} Targets`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
