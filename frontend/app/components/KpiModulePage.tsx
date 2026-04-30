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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DataTable } from '@/app/components/DataTable';
import { fetchApi, getUsersForModule } from '@/app/lib/api';
import { useAuth } from '@/app/context/AuthContext';
import { ChevronLeft, ChevronRight, Plus, MoreHorizontal, Users } from 'lucide-react';
import { FormDatePicker } from '@/components/ui/form-date-picker';
import { DateRangeFilter } from '@/components/ui/date-range-filter';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { formatDate } from '@/app/lib/date';
import { toast } from 'sonner';
import { useConfirm } from '@/app/components/ConfirmDialog';

// ─── Shared types ────────────────────────────────────────────────────────────

export interface BaseModuleEntry {
  id: number;
  date: string;
  added_by: number;
  added_by_name: string;
  on_behalf_of: number | null;
  on_behalf_of_name: string | null;
  added_at: string;
  is_editable: boolean;
  [key: string]: unknown;
}

export function AddedByCell({ entry }: { entry: { added_by_name: string; on_behalf_of_name: string | null } }) {
  return (
    <div className="flex items-center gap-2">
      <UserAvatar name={entry.added_by_name} />
      <span className="text-sm font-medium text-[#374151] truncate max-w-[140px]">
        {entry.added_by_name}
      </span>
    </div>
  );
}

export interface WeeklyColumnSpec<T> {
  key: keyof T & string;
  header: string;
  render?: (value: unknown, entry: T) => React.ReactNode;
}

export interface DataColumnSpec<T> {
  key: string;
  header: string;
  render?: (item: T) => React.ReactNode;
}

export interface ModalFieldSpec {
  key: string;
  label: string;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
}

interface ModuleUser {
  id: number;
  email: string;
  full_name: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function ownerId(e: { added_by: number; on_behalf_of?: number | null }): number {
  return e.on_behalf_of ?? e.added_by;
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
const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thur', 'Fri', 'Sat', 'Sun'];

// ─── Status Badge ────────────────────────────────────────────────────────────

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

// ─── User Avatar ─────────────────────────────────────────────────────────────

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

// ─── Personal Daily Tracker ──────────────────────────────────────────────────

function PersonalDailyTracker<T extends BaseModuleEntry>({
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
  monthEntries: T[];
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
      <div className="flex items-center gap-2 px-5 py-2.5 border-b border-[#E4E4E4]">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-[#6366F1]">
          <rect x="1" y="2" width="14" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M1 6h14" stroke="currentColor" strokeWidth="1.5" />
          <path d="M5 1v2M11 1v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span className="text-sm font-semibold text-[#09090B]">{trackerTitle}</span>
      </div>

      <div className="flex items-center justify-between px-5 py-2 border-b border-[#E4E4E4]">
        <div className="flex items-center gap-3">
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

      <div className="px-4 py-2.5 overflow-x-auto">
        <div className="flex w-full border border-[#E4E4E4] rounded-lg overflow-hidden">
          {Array.from({ length: daysInMonth }, (_, i) => new Date(calYear, calMonth, i + 1)).map((d, i) => {
            const ds = toLocalDateString(d);
            const isSunday = d.getDay() === 0;
            const isToday = sameDay(d, today);
            const isPast = d < today && !isToday;
            const hasEntry = monthEntries.some((e) => e.date === ds && ownerId(e) === currentUserId);

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

// ─── Tracker View ────────────────────────────────────────────────────────────

function TrackerView<T extends BaseModuleEntry>({
  calYear,
  calMonth,
  monthEntries,
  moduleUsers,
  trackerUserFilter,
  deptLabel,
  onTrackerUserFilterChange,
  onPrevMonth,
  onNextMonth,
  onGoToday,
}: {
  calYear: number;
  calMonth: number;
  monthEntries: T[];
  moduleUsers: ModuleUser[];
  trackerUserFilter: string;
  deptLabel: string;
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
      <div className="flex items-center gap-2 px-5 py-2.5 border-b border-[#E4E4E4]">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-[#6366F1]">
          <rect x="1" y="2" width="14" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M1 6h14" stroke="currentColor" strokeWidth="1.5" />
          <path d="M5 1v2M11 1v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span className="text-sm font-semibold text-[#09090B]">Team Daily Tracker</span>
      </div>

      <div className="bg-white flex items-center justify-between px-5 py-2 border-b border-[#E4E4E4] flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center rounded-lg border border-[#E4E4E4] overflow-hidden text-xs font-medium">
            <button className="px-3 py-1.5 bg-white text-[#09090B]">
              Month
            </button>
          </div>

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

      <div className="overflow-auto max-h-[calc(100vh-15rem)] scrollbar-hide">
        <table className="border-collapse w-full min-w-max">
          <thead className="sticky top-0 z-20">
            <tr className="border-b border-[#E4E4E4]">
              <th className="sticky left-0 z-30 bg-[#F9F9F9] px-4 py-3 text-left min-w-[180px] border-r border-[#E4E4E4]">
                <div className="text-sm font-semibold text-[#09090B]">{deptLabel}</div>
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

function WeeklyView<T extends BaseModuleEntry>({
  weekStart,
  monthEntries,
  today,
  weeklyColumns,
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
  monthEntries: T[];
  today: Date;
  weeklyColumns: WeeklyColumnSpec<T>[];
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onGoToCurrentWeek: () => void;
  onAddRecord: (date: string) => void;
  onEdit: (entry: T) => void;
  onDelete: (entry: T) => void;
  moduleUsers: ModuleUser[];
  weeklyUserFilter: string;
  onWeeklyUserFilterChange: (v: string) => void;
  isAdmin: boolean;
  currentUserId: number | undefined;
  navStickyTop?: string;
  tableMaxHeight?: string;
}) {
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const getEntriesForDay = (d: Date): T[] => {
    const ds = toLocalDateString(d);
    let entries = monthEntries.filter((e) => e.date === ds);
    if (weeklyUserFilter !== 'all') {
      entries = entries.filter((e) => String(ownerId(e)) === weeklyUserFilter);
    } else if (!isAdmin) {
      entries = entries.filter((e) => ownerId(e) === currentUserId);
    }
    return entries.sort((a, b) => new Date(b.added_at).getTime() - new Date(a.added_at).getTime());
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
  const formatShortDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const weekDateRangeLabel =
    weekStart.getFullYear() === weekEndDay.getFullYear()
      ? `${formatShortDate(weekStart)} – ${formatShortDate(weekEndDay)}, ${weekEndDay.getFullYear()}`
      : `${formatShortDate(weekStart)}, ${weekStart.getFullYear()} – ${formatShortDate(weekEndDay)}, ${weekEndDay.getFullYear()}`;

  return (
    <div className="bg-white rounded-2xl border border-[#E4E4E4] shadow-sm">
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

      <div className="overflow-auto scrollbar-hide" style={{ maxHeight: tableMaxHeight }}>
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#F9F9F9] border-b border-[#E4E4E4]">
              <th className="px-5 py-3 text-left text-xs font-medium text-[#71717A] tracking-wide w-[140px]">
                Day
              </th>
              {weeklyColumns.map((col) => (
                <th key={col.key} className="px-5 py-3 text-left text-xs font-medium text-[#71717A] tracking-wide">
                  {col.header}
                </th>
              ))}
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
              const future = isFutureDay(d);
              void future;
              const past = isPastDay(d);

              if (entries.length === 0) {
                let statusType: 'submitted' | 'not_submitted' | 'upcoming' = 'upcoming';
                if (past && !isSun) statusType = 'not_submitted';

                // Admin can only add records for themselves; viewing another user is read-only.
                const isViewingSelf =
                  weeklyUserFilter === 'all' || weeklyUserFilter === String(currentUserId);
                const canAddToday = isToday && !isSun && isViewingSelf;
                const todayEntryExists = isToday
                  ? monthEntries.some(
                      (e) =>
                        e.date === toLocalDateString(d) &&
                        (weeklyUserFilter === 'all'
                          ? ownerId(e) === currentUserId
                          : String(ownerId(e)) === weeklyUserFilter)
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
                    {weeklyColumns.map((col) => (
                      <td key={col.key} className="px-5 py-3">
                        {!isSun && <span className="text-[#D1D5DB]">—</span>}
                      </td>
                    ))}
                    <td className="px-5 py-3" />
                    <td className="px-5 py-3">
                      {!isSun && (
                        canAddToday && !todayEntryExists ? (
                          <Button
                            size="sm"
                            className="h-8 px-3 text-xs font-medium rounded-lg gap-1"
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
                    {eIdx === 0 && (
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
                    )}
                    {eIdx > 0 && <td className="px-5 py-3" />}
                    {weeklyColumns.map((col) => {
                      const raw = entry[col.key as keyof T];
                      return (
                        <td key={col.key} className="px-5 py-3 text-sm font-medium text-[#374151]">
                          {col.render ? col.render(raw, entry) : (raw as React.ReactNode)}
                        </td>
                      );
                    })}
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

// ─── Entry Modal ─────────────────────────────────────────────────────────────

function EntryModal<T extends BaseModuleEntry>({
  isOpen,
  onClose,
  onSave,
  entry,
  initialDate,
  error,
  modalFields,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: Record<string, unknown>) => void;
  entry: T | null;
  initialDate: string;
  error: string;
  modalFields: ModalFieldSpec[];
}) {
  const buildInitial = (): Record<string, string> => {
    const base: Record<string, string> = { date: '' };
    modalFields.forEach((f) => { base[f.key] = ''; });
    return base;
  };

  const [formData, setFormData] = useState<Record<string, string>>(buildInitial);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (entry) {
      const next: Record<string, string> = { date: entry.date };
      modalFields.forEach((f) => {
        const v = entry[f.key];
        next[f.key] = v === null || v === undefined ? '' : String(v);
      });
      setFormData(next);
    } else {
      const next: Record<string, string> = { date: initialDate || toLocalDateString(new Date()) };
      modalFields.forEach((f) => { next[f.key] = ''; });
      setFormData(next);
    }
  }, [entry, isOpen, initialDate, modalFields]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    const payload: Record<string, unknown> = { date: formData.date };
    modalFields.forEach((f) => {
      payload[f.key] = Number(formData[f.key]);
    });
    await onSave(payload);
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
          <div className="space-y-2">
            <Label className="text-sm font-medium text-[#374151]">Date</Label>
            <div className="h-9 px-3 flex items-center rounded-md border border-[#E4E4E4] bg-[#F9F9F9] text-sm text-[#374151]">
              {formData.date ? formatDate(formData.date) : '—'}
            </div>
          </div>
          {modalFields.map((f) => (
            <div key={f.key} className="space-y-2">
              <Label className="text-sm font-medium text-[#374151]">{f.label}</Label>
              <Input
                type="number"
                min={f.min ?? 0}
                max={f.max}
                step={f.step ?? 1}
                placeholder={f.placeholder ?? '0'}
                value={formData[f.key] ?? ''}
                onChange={(e) => setFormData((prev) => ({ ...prev, [f.key]: e.target.value }))}
                required
              />
            </div>
          ))}
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

// ─── Main KpiModulePage ──────────────────────────────────────────────────────

export interface KpiModulePageProps<T extends BaseModuleEntry> {
  moduleKey: string;
  apiSlug: string;
  title: string;
  deptLabel: string;
  weeklyColumns: WeeklyColumnSpec<T>[];
  dataColumns: DataColumnSpec<T>[];
  modalFields: ModalFieldSpec[];
}

export function KpiModulePage<T extends BaseModuleEntry>({
  moduleKey,
  apiSlug,
  title,
  deptLabel,
  weeklyColumns,
  dataColumns,
  modalFields,
}: KpiModulePageProps<T>) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { canSeeAllData, user } = useAuth();
  const confirm = useConfirm();

  const isAdmin = canSeeAllData();
  const currentUserId = user?.id;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [activeView, setActiveView] = useState<'tracker' | 'weekly' | 'data'>('weekly');

  // Independent calendar state per tracker (Item 7: navigation must not couple).
  const [personalCalYear, setPersonalCalYear] = useState(today.getFullYear());
  const [personalCalMonth, setPersonalCalMonth] = useState(today.getMonth());
  const [teamCalYear, setTeamCalYear] = useState(today.getFullYear());
  const [teamCalMonth, setTeamCalMonth] = useState(today.getMonth());
  const [trackerUserFilter, setTrackerUserFilter] = useState('all');

  const [weekStart, setWeekStart] = useState<Date>(startOfWeek(today));
  const [weeklyUserFilter, setWeeklyUserFilter] = useState('all');

  const [dataDateFrom, setDataDateFrom] = useState('');
  const [dataDateTo, setDataDateTo] = useState('');
  const [dataUserFilter, setDataUserFilter] = useState('all');

  const [monthEntries, setMonthEntries] = useState<T[]>([]);
  const [moduleUsers, setModuleUsers] = useState<ModuleUser[]>([]);

  const [dataEntries, setDataEntries] = useState<T[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [dataLoading, setDataLoading] = useState(false);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<T | null>(null);
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

  const fetchEntriesForMonths = useCallback(async (months: Array<[number, number]>) => {
    try {
      const unique = Array.from(new Set(months.map(([y, m]) => `${y}-${m}`))).map((s) => {
        const [y, m] = s.split('-').map(Number);
        return [y, m] as [number, number];
      });
      const responses = await Promise.all(
        unique.map(([year, month]) => {
          const firstDay = `${year}-${String(month + 1).padStart(2, '0')}-01`;
          const lastDay = toLocalDateString(new Date(year, month + 1, 0));
          const params = new URLSearchParams({ date_from: firstDay, date_to: lastDay, page_size: '1000' });
          return fetchApi<{ results: T[] }>(`/api/entries/${apiSlug}/?${params}`);
        })
      );
      const merged = new Map<number, T>();
      for (const res of responses) {
        for (const entry of res.data?.results || []) {
          merged.set(entry.id, entry);
        }
      }
      setMonthEntries(Array.from(merged.values()));
    } catch {
      setMonthEntries([]);
    }
  }, [apiSlug]);

  const refetchAllMonths = useCallback(() => {
    const weekEndDay = addDays(weekStart, 6);
    fetchEntriesForMonths([
      [personalCalYear, personalCalMonth],
      [teamCalYear, teamCalMonth],
      [weekStart.getFullYear(), weekStart.getMonth()],
      [weekEndDay.getFullYear(), weekEndDay.getMonth()],
    ]);
  }, [
    fetchEntriesForMonths,
    personalCalYear,
    personalCalMonth,
    teamCalYear,
    teamCalMonth,
    weekStart,
  ]);

  const fetchDataEntries = useCallback(async () => {
    setDataLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
      if (dataDateFrom) params.set('date_from', dataDateFrom);
      if (dataDateTo) params.set('date_to', dataDateTo);
      if (dataUserFilter !== 'all') params.set('user_id', dataUserFilter);
      const result = await fetchApi<{ results: T[]; count: number }>(`/api/entries/${apiSlug}/?${params}`);
      setDataEntries(result.data?.results || []);
      setTotalCount(result.data?.count || 0);
    } catch {
      setDataEntries([]);
    }
    setDataLoading(false);
  }, [page, pageSize, dataDateFrom, dataDateTo, dataUserFilter, apiSlug]);

  useEffect(() => {
    if (!isAdmin) return;
    getUsersForModule(moduleKey).then((res) => {
      if (res.data) {
        setModuleUsers(res.data);
        if (currentUserId) {
          setWeeklyUserFilter(String(currentUserId));
        } else if (res.data.length > 0) {
          setWeeklyUserFilter(String(res.data[0].id));
        }
      }
    });
  }, [isAdmin, moduleKey, currentUserId]);

  useEffect(() => {
    refetchAllMonths();
  }, [refetchAllMonths]);

  useEffect(() => {
    if (activeView === 'data') fetchDataEntries();
  }, [activeView, page, pageSize, dataDateFrom, dataDateTo, dataUserFilter, fetchDataEntries]);

  const prevPersonalMonth = () => {
    if (personalCalMonth === 0) { setPersonalCalYear(y => y - 1); setPersonalCalMonth(11); }
    else setPersonalCalMonth(m => m - 1);
  };
  const nextPersonalMonth = () => {
    if (personalCalMonth === 11) { setPersonalCalYear(y => y + 1); setPersonalCalMonth(0); }
    else setPersonalCalMonth(m => m + 1);
  };
  const goPersonalToday = () => {
    setPersonalCalYear(today.getFullYear());
    setPersonalCalMonth(today.getMonth());
  };

  const prevTeamMonth = () => {
    if (teamCalMonth === 0) { setTeamCalYear(y => y - 1); setTeamCalMonth(11); }
    else setTeamCalMonth(m => m - 1);
  };
  const nextTeamMonth = () => {
    if (teamCalMonth === 11) { setTeamCalYear(y => y + 1); setTeamCalMonth(0); }
    else setTeamCalMonth(m => m + 1);
  };
  const goTeamToday = () => {
    setTeamCalYear(today.getFullYear());
    setTeamCalMonth(today.getMonth());
  };

  const todayStr = toLocalDateString(today);
  const todaySubmitted = monthEntries.some(
    (e) => e.date === todayStr && ownerId(e) === currentUserId
  );

  const handleSave = async (formData: Record<string, unknown>) => {
    setModalError('');
    const endpoint = editingEntry
      ? `/api/entries/${apiSlug}/${editingEntry.id}/`
      : `/api/entries/${apiSlug}/`;
    const result = await fetchApi<T>(endpoint, {
      method: editingEntry ? 'PATCH' : 'POST',
      body: JSON.stringify(formData),
    });
    if (result.data) {
      setIsModalOpen(false);
      setEditingEntry(null);
      setModalDate('');
      refetchAllMonths();
      if (activeView === 'data') fetchDataEntries();
    } else {
      setModalError(result.error || 'Failed to save entry');
    }
  };

  const handleDelete = async (entry: T) => {
    const ok = await confirm({
      title: 'Delete entry?',
      description: 'This action cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    const result = await fetchApi<void>(`/api/entries/${apiSlug}/${entry.id}/`, {
      method: 'DELETE',
    });
    if (!result.error) {
      refetchAllMonths();
      if (activeView === 'data') fetchDataEntries();
    } else {
      toast.error(result.error || 'Failed to delete entry');
    }
  };

  const openAddModal = (date?: string) => {
    setEditingEntry(null);
    setModalError('');
    setModalDate(date || todayStr);
    setIsModalOpen(true);
  };
  const openEditModal = (entry: T) => {
    setEditingEntry(entry);
    setModalError('');
    setModalDate('');
    setIsModalOpen(true);
  };

  const addedByColumn: DataColumnSpec<T> = {
    key: 'added_by_name',
    header: 'Added by',
    render: (item: T) => <AddedByCell entry={item} />,
  };

  const addedOnColumn: DataColumnSpec<T> = {
    key: 'added_at',
    header: 'Added on',
    render: (item: T) => formatDate(item.added_at.split('T')[0]),
  };

  const fullDataColumns: DataColumnSpec<T>[] = [
    {
      key: 'date',
      header: 'Record date',
      render: (item: T) => formatDate(item.date),
    },
    ...dataColumns,
    addedByColumn,
    addedOnColumn,
  ];

  const dataViewContent = (
    <div className="bg-white rounded-2xl border border-[#E4E4E4] shadow-sm flex flex-col" style={{ height: 'calc(100vh - 20rem)' }}>
      <div className="flex items-center justify-end px-5 py-4 border-b border-[#E4E4E4] flex-wrap gap-3 shrink-0">
        <div className="flex items-end gap-3 mr-auto">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-[#71717A]">Date Range</span>
            <DateRangeFilter
              dateFrom={dataDateFrom}
              dateTo={dataDateTo}
              onChange={(from, to) => {
                setDataDateFrom(from);
                setDataDateTo(to);
                updateParams({ page: 1 });
              }}
            />
          </div>
          {isAdmin && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-[#71717A]">User</span>
              <Select value={dataUserFilter} onValueChange={(v) => { setDataUserFilter(v); updateParams({ page: 1 }); }}>
                <SelectTrigger className="h-9 text-sm border-[#E4E4E4] rounded-lg px-3 gap-1.5 w-auto min-w-[160px]">
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
          )}
        </div>

        {/* TODO: confirm with PM whether to keep configurable. Hidden per Bug 11.
        <Button
          onClick={() => openAddModal()}
          disabled={todaySubmitted}
          title={todaySubmitted ? 'Already submitted today' : undefined}
          className="h-9 px-4 text-sm font-medium rounded-lg gap-1.5"
        >
          <Plus className="h-4 w-4" />
          Add record
        </Button>
        */}
      </div>

      <div className="flex-1 min-h-0">
        <DataTable
          columns={fullDataColumns}
          data={dataEntries}
          totalCount={totalCount}
          page={page}
          pageSize={pageSize}
          onPageChange={(p) => updateParams({ page: p })}
          onPageSizeChange={(s) => updateParams({ pageSize: s, page: 1 })}
          onEdit={openEditModal}
          onDelete={handleDelete}
          canEdit={(entry) => entry.is_editable}
          canDelete={(entry) => entry.added_by === currentUserId}
          isLoading={dataLoading}
          height="h-full !border-0 !rounded-none"
        />
      </div>
    </div>
  );

  const weeklyViewContent = (isAgentLayout: boolean) => (
    <WeeklyView
      weekStart={weekStart}
      monthEntries={monthEntries}
      today={today}
      weeklyColumns={weeklyColumns}
      onPrevWeek={() => setWeekStart(addDays(weekStart, -7))}
      onNextWeek={() => setWeekStart(addDays(weekStart, 7))}
      onGoToCurrentWeek={() => setWeekStart(startOfWeek(today))}
      onAddRecord={openAddModal}
      onEdit={openEditModal}
      onDelete={handleDelete}
      moduleUsers={moduleUsers}
      weeklyUserFilter={weeklyUserFilter}
      onWeeklyUserFilterChange={setWeeklyUserFilter}
      isAdmin={isAdmin}
      currentUserId={currentUserId}
      navStickyTop={isAgentLayout ? 'top-[7.5rem]' : 'top-39'}
    />
  );

  const modal = (
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
      modalFields={modalFields}
    />
  );

  if (!isAdmin) {
    const agentView = activeView === 'data' ? 'data' : 'weekly';
    return (
      <div className="p-6 space-y-4">
        <h1 className="text-2xl font-bold text-[#09090B]">{title}</h1>

        <PersonalDailyTracker
          calYear={personalCalYear}
          calMonth={personalCalMonth}
          today={today}
          monthEntries={monthEntries}
          currentUserId={currentUserId}
          userFullName={user?.full_name || ''}
          onPrevMonth={prevPersonalMonth}
          onNextMonth={nextPersonalMonth}
          onGoToday={goPersonalToday}
        />

        <Tabs value={agentView} onValueChange={(v) => setActiveView(v as typeof activeView)} className="gap-0">
          <div className="sticky top-16 z-20 bg-white py-2">
            <TabsList className="bg-[#F3F4F6] rounded-lg p-1 gap-0">
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

          <TabsContent value="weekly" className="mt-4">
            {weeklyViewContent(true)}
          </TabsContent>
          <TabsContent value="data" className="mt-4">
            {dataViewContent}
          </TabsContent>
        </Tabs>

        {modal}
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5">
      <h1 className="text-2xl font-bold text-[#09090B]">{title}</h1>

      <PersonalDailyTracker
        calYear={personalCalYear}
        calMonth={personalCalMonth}
        today={today}
        monthEntries={monthEntries}
        currentUserId={currentUserId}
        userFullName={user?.full_name || ''}
        onPrevMonth={prevPersonalMonth}
        onNextMonth={nextPersonalMonth}
        onGoToday={goPersonalToday}
      />

      <Tabs value={activeView} onValueChange={(v) => setActiveView(v as typeof activeView)} className="gap-0">
        <div className="sticky top-16 z-20 bg-white py-2">
          <TabsList className="bg-[#F3F4F6] rounded-lg p-1 gap-0">
            <TabsTrigger
              value="tracker"
              className="px-4 py-1.5 text-sm font-medium rounded-lg data-[state=active]:bg-white data-[state=active]:text-[#09090B] data-[state=active]:border data-[state=active]:border-[#E4E4E4] data-[state=active]:shadow-none data-[state=inactive]:bg-transparent data-[state=inactive]:text-[#6B7280] data-[state=inactive]:border-transparent"
            >
              Tracker View
            </TabsTrigger>
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

        <TabsContent value="tracker" className="mt-4">
          <TrackerView
            calYear={teamCalYear}
            calMonth={teamCalMonth}
            monthEntries={monthEntries}
            moduleUsers={moduleUsers}
            trackerUserFilter={trackerUserFilter}
            deptLabel={deptLabel}
            onTrackerUserFilterChange={setTrackerUserFilter}
            onPrevMonth={prevTeamMonth}
            onNextMonth={nextTeamMonth}
            onGoToday={goTeamToday}
          />
        </TabsContent>
        <TabsContent value="weekly" className="mt-4">
          {weeklyViewContent(false)}
        </TabsContent>
        <TabsContent value="data" className="mt-4">
          {dataViewContent}
        </TabsContent>
      </Tabs>

      {modal}
    </div>
  );
}
