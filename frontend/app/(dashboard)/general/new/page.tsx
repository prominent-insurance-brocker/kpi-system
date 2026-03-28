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
import { API_BASE_URL, getUsersForModule } from '@/app/lib/api';
import { useAuth } from '@/app/context/AuthContext';
import { ChevronLeft, ChevronRight, Plus, MoreHorizontal, Users } from 'lucide-react';
import { FormDatePicker } from '@/components/ui/form-date-picker';
import { formatDate, formatDateTime } from '@/app/lib/date';

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

interface ModuleUser {
  id: number;
  email: string;
  full_name: string;
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
  onPrevMonth,
  onNextMonth,
  onGoToday,
}: {
  calYear: number;
  calMonth: number;
  today: Date;
  monthEntries: GeneralNewEntry[];
  currentUserId: number | undefined;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onGoToday: () => void;
}) {
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();

  return (
    <div className="bg-white rounded-2xl border border-[#E4E4E4] shadow-sm">
      {/* Card header */}
      <div className="flex items-center gap-2 px-5 pt-4 pb-3 border-b border-[#E4E4E4]">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-[#6366F1]">
          <rect x="1" y="2" width="14" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M1 6h14" stroke="currentColor" strokeWidth="1.5" />
          <path d="M5 1v2M11 1v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span className="text-sm font-semibold text-[#09090B]">Daily Tracker</span>
      </div>

      {/* Controls row */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[#F3F3F3]">
        <div className="flex items-center gap-3">
          {/* Month/Year toggle */}
          <div className="flex items-center rounded-lg border border-[#E4E4E4] overflow-hidden text-xs font-medium">
            <button className="px-3 py-1.5 bg-white text-[#09090B] border-r border-[#E4E4E4]">Month</button>
            <button className="px-3 py-1.5 text-[#71717A] hover:bg-[#F9F9F9] transition-colors">Year</button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onPrevMonth}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[#F3F3F3] transition-colors"
          >
            <ChevronLeft className="h-4 w-4 text-[#71717A]" />
          </button>
          <button
            onClick={onGoToday}
            className="text-sm font-medium text-[#09090B] px-3 py-1 rounded-lg border border-[#E4E4E4] hover:bg-[#F3F3F3] transition-colors"
          >
            Today
          </button>
          <button
            onClick={onNextMonth}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[#F3F3F3] transition-colors"
          >
            <ChevronRight className="h-4 w-4 text-[#71717A]" />
          </button>
          <span className="text-sm font-semibold text-[#09090B] ml-1">
            {MONTH_NAMES[calMonth]} {calYear}
          </span>
        </div>
      </div>

      {/* Day cells strip */}
      <div className="px-4 py-3 overflow-x-auto">
        <div className="flex gap-1 min-w-max">
          {Array.from({ length: daysInMonth }, (_, i) => new Date(calYear, calMonth, i + 1)).map((d) => {
            const ds = toLocalDateString(d);
            const isSunday = d.getDay() === 0;
            const isToday = sameDay(d, today);
            const isPast = d < today && !isToday;
            const hasEntry = monthEntries.some((e) => e.date === ds && e.added_by === currentUserId);

            let cellBg = '';
            let cellStyle: React.CSSProperties | undefined;
            if (isSunday) {
              cellStyle = {
                backgroundImage: 'repeating-linear-gradient(135deg,#D1D5DB 0,#D1D5DB 1px,transparent 1px,transparent 6px)',
                backgroundColor: '#F9FAFB',
              };
            } else if (hasEntry) {
              cellBg = 'bg-[#DCFCE7]';
            } else if (isToday) {
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
                <span className={`text-xs font-semibold leading-none ${
                  isToday
                    ? 'w-5 h-5 flex items-center justify-center rounded-full bg-[#4F46E5] text-white'
                    : isSunday
                    ? 'text-[#9CA3AF]'
                    : 'text-[#09090B]'
                }`}>
                  {d.getDate()}
                </span>
                <span className={`text-[10px] mt-0.5 leading-none ${isSunday ? 'text-[#9CA3AF]' : 'text-[#71717A]'}`}>
                  {SHORT_DAY[d.getDay()]}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Tracker View ─────────────────────────────────────────────────────────────

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
  monthEntries: GeneralNewEntry[];
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
    <div className="bg-white rounded-2xl border border-[#E4E4E4] shadow-sm">
      {/* Sticky controls row — offset below the admin sticky page header (~92px) */}
      <div className="sticky top-39 z-10 bg-white rounded-t-2xl flex items-center justify-between px-5 py-4 border-b border-[#E4E4E4] flex-wrap gap-3">
        <div className="flex items-center gap-3">
          {/* Month/Year toggle */}
          <div className="flex items-center rounded-lg border border-[#E4E4E4] overflow-hidden text-xs font-medium">
            <button className="px-3 py-1.5 bg-white text-[#09090B] border-r border-[#E4E4E4]">
              Month
            </button>
            <button className="px-3 py-1.5 text-[#71717A] hover:bg-[#F9F9F9] transition-colors">
              Year
            </button>
          </div>

          {/* Month navigation */}
          <div className="flex items-center gap-1">
            <button
              onClick={onPrevMonth}
              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[#F3F3F3] transition-colors"
            >
              <ChevronLeft className="h-4 w-4 text-[#71717A]" />
            </button>
            <Select value={`${calYear}-${calMonth}`} onValueChange={(v) => {
              const [y, m] = v.split('-').map(Number);
              onTrackerUserFilterChange(trackerUserFilter);
              // navigate by using today detection—handled by parent via direct month select
              void y; void m;
            }}>
              <SelectTrigger className="h-8 text-sm font-medium border-none shadow-none focus:ring-0 px-2 gap-1 w-auto">
                <SelectValue>{MONTH_NAMES[calMonth]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {MONTH_NAMES.map((name, idx) => (
                  <SelectItem key={idx} value={`${calYear}-${idx}`}>
                    {name} {calYear}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button
              onClick={onNextMonth}
              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[#F3F3F3] transition-colors"
            >
              <ChevronRight className="h-4 w-4 text-[#71717A]" />
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
          <button
            onClick={onGoToday}
            className="text-sm font-medium text-[#09090B] px-3 py-1.5 rounded-lg border border-[#E4E4E4] hover:bg-[#F3F3F3] transition-colors"
          >
            Today
          </button>
          <span className="text-sm font-semibold text-[#09090B]">
            {MONTH_NAMES[calMonth]} {calYear}
          </span>
        </div>
      </div>

      {/* Grid — scrollable independently so sticky thead works */}
      <div className="overflow-auto max-h-[calc(100vh-15rem)] scrollbar-hide">
        <table className="border-collapse w-full min-w-max">
          <thead className="sticky top-0 z-20">
            <tr className="border-b border-[#E4E4E4]">
              {/* Dept header spanning user column */}
              <th className="sticky left-0 z-30 bg-[#F9F9F9] px-4 py-3 text-left min-w-[180px]">
                <div className="text-sm font-semibold text-[#09090B]">General New DEPT.</div>
                <div className="text-xs text-[#71717A]">{visibleUsers.length} members</div>
              </th>
              {calDays.map((d) => {
                const isSun = d.getDay() === 0;
                const isToday = sameDay(d, today);
                return (
                  <th
                    key={d.getDate()}
                    className={`px-1 py-2 text-center min-w-[36px] ${
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
          <tbody className="divide-y divide-[#F3F3F3]">
            {visibleUsers.length === 0 ? (
              <tr>
                <td colSpan={daysInMonth + 1} className="px-4 py-8 text-center text-sm text-[#71717A]">
                  No users found
                </td>
              </tr>
            ) : (
              visibleUsers.map((user) => (
                <tr key={user.id} className="hover:bg-[#FAFAFA] transition-colors">
                  <td className="sticky left-0 z-10 bg-white hover:bg-[#FAFAFA] px-4 py-3 min-w-[180px]">
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
                        className={`px-1 py-2 ${cellBg}`}
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
  monthEntries: GeneralNewEntry[];
  today: Date;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onAddRecord: (date: string) => void;
  onEdit: (entry: GeneralNewEntry) => void;
  onDelete: (entry: GeneralNewEntry) => void;
  moduleUsers: ModuleUser[];
  weeklyUserFilter: string;
  onWeeklyUserFilterChange: (v: string) => void;
  isAdmin: boolean;
  currentUserId: number | undefined;
  navStickyTop?: string;
  tableMaxHeight?: string;
}) {
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const getEntriesForDay = (d: Date): GeneralNewEntry[] => {
    const ds = toLocalDateString(d);
    let entries = monthEntries.filter((e) => e.date === ds);
    if (weeklyUserFilter !== 'all') {
      entries = entries.filter((e) => String(e.added_by) === weeklyUserFilter);
    } else if (!isAdmin) {
      entries = entries.filter((e) => e.added_by === currentUserId);
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
  const weekMonthLabel =
    weekStart.getMonth() === weekEndDay.getMonth()
      ? `${MONTH_NAMES[weekStart.getMonth()]} ${weekStart.getFullYear()}`
      : `${MONTH_NAMES[weekStart.getMonth()]} – ${MONTH_NAMES[weekEndDay.getMonth()]} ${weekEndDay.getFullYear()}`;

  const effectiveUserId = weeklyUserFilter !== 'all' ? Number(weeklyUserFilter) : currentUserId;

  return (
    <div className="bg-white rounded-2xl border border-[#E4E4E4] shadow-sm">
      {/* Sticky week nav bar */}
      <div className={`sticky ${navStickyTop} z-10 bg-white rounded-t-2xl flex items-center justify-between px-5 py-4 border-b border-[#E4E4E4]`}>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Select value={weeklyUserFilter} onValueChange={onWeeklyUserFilterChange}>
              <SelectTrigger className="h-8 text-sm border-[#E4E4E4] rounded-lg px-3 gap-1.5 w-auto min-w-[130px]">
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
          )}
        </div>

        <div className="flex items-center gap-2">
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
      </div>

      {/* Table — scrollable container so sticky thead works relative to it */}
      <div className="overflow-auto scrollbar-hide" style={{ maxHeight: tableMaxHeight }}>
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#F9F9F9] border-b border-[#E4E4E4]">
              <th className="px-5 py-3 text-left text-xs font-medium text-[#71717A] uppercase tracking-wide w-[140px]">
                Day
              </th>
              <th className="px-5 py-3 text-left text-xs font-medium text-[#71717A] uppercase tracking-wide">
                Quotations
              </th>
              <th className="px-5 py-3 text-left text-xs font-medium text-[#71717A] uppercase tracking-wide">
                Quotes revised
              </th>
              <th className="px-5 py-3 text-left text-xs font-medium text-[#71717A] uppercase tracking-wide">
                Quotes converted
              </th>
              <th className="px-5 py-3 text-left text-xs font-medium text-[#71717A] uppercase tracking-wide">
                Added by
              </th>
              <th className="px-5 py-3 text-left text-xs font-medium text-[#71717A] uppercase tracking-wide w-[180px]">
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

                const canAddToday = isToday && !isSun;
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
                        <span className={`text-sm font-semibold leading-tight ${isToday ? 'text-[#4F46E5]' : 'text-[#09090B]'}`}>
                          {WEEKDAY_NAMES[idx]}
                        </span>
                        <span className="text-xs text-[#9CA3AF] leading-tight">
                          {d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3"><span className="text-[#D1D5DB]">—</span></td>
                    <td className="px-5 py-3"><span className="text-[#D1D5DB]">—</span></td>
                    <td className="px-5 py-3"><span className="text-[#D1D5DB]">—</span></td>
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
                      {!isSun && (
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
                const hasEntry = true;
                let statusType: 'submitted' | 'not_submitted' | 'upcoming' = 'submitted';
                void hasEntry;

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
                          <span className={`text-sm font-semibold leading-tight ${isToday ? 'text-[#4F46E5]' : 'text-[#09090B]'}`}>
                            {WEEKDAY_NAMES[idx]}
                          </span>
                          <span className="text-xs text-[#9CA3AF] leading-tight">
                            {d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </span>
                        </div>
                      </td>
                    )}
                    {eIdx > 0 && <td className="px-5 py-3" />}
                    <td className="px-5 py-3 text-sm font-medium text-[#374151]">{entry.quotations}</td>
                    <td className="px-5 py-3 text-sm font-medium text-[#374151]">{entry.quotes_revised}</td>
                    <td className="px-5 py-3 text-sm font-medium text-[#374151]">{entry.quotes_converted}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <UserAvatar name={entry.added_by_name} />
                        <span className="text-sm font-medium text-[#374151] truncate max-w-[120px]">
                          {entry.added_by_name}
                        </span>
                      </div>
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
                          {(entry.added_by === effectiveUserId || isAdmin) && (
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

type DateRangeOption = 'all' | 'this_month' | 'last_month' | 'this_year';

function getDateRange(option: DateRangeOption): { date_from?: string; date_to?: string } {
  const now = new Date();
  if (option === 'this_month') {
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { date_from: toLocalDateString(firstDay), date_to: toLocalDateString(lastDay) };
  }
  if (option === 'last_month') {
    const firstDay = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
    return { date_from: toLocalDateString(firstDay), date_to: toLocalDateString(lastDay) };
  }
  if (option === 'this_year') {
    const firstDay = new Date(now.getFullYear(), 0, 1);
    const lastDay = new Date(now.getFullYear(), 11, 31);
    return { date_from: toLocalDateString(firstDay), date_to: toLocalDateString(lastDay) };
  }
  return {};
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function GeneralNewPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { canSeeAllData, user } = useAuth();

  const isAdmin = canSeeAllData();
  const currentUserId = user?.id;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [activeView, setActiveView] = useState<'tracker' | 'weekly' | 'data'>('weekly');

  // Calendar / tracker state
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const [trackerUserFilter, setTrackerUserFilter] = useState('all');

  // Weekly state
  const [weekStart, setWeekStart] = useState<Date>(startOfWeek(today));
  const [weeklyUserFilter, setWeeklyUserFilter] = useState('all');

  // Data view state
  const [dataDateRange, setDataDateRange] = useState<DateRangeOption>('all');
  const [dataUserFilter, setDataUserFilter] = useState('all');

  // Shared data
  const [monthEntries, setMonthEntries] = useState<GeneralNewEntry[]>([]);
  const [moduleUsers, setModuleUsers] = useState<ModuleUser[]>([]);

  // Data view pagination
  const [dataEntries, setDataEntries] = useState<GeneralNewEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [dataLoading, setDataLoading] = useState(false);

  // Modal state
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

  // Fetch month entries (used by tracker + weekly views)
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

  // Fetch paginated data view entries
  const fetchDataEntries = useCallback(async () => {
    setDataLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
      const range = getDateRange(dataDateRange);
      if (range.date_from) params.set('date_from', range.date_from);
      if (range.date_to) params.set('date_to', range.date_to);
      if (dataUserFilter !== 'all') params.set('user_id', dataUserFilter);
      const res = await fetch(`${API_BASE_URL}/api/entries/general-new/?${params}`, { credentials: 'include' });
      const data = await res.json();
      setDataEntries(data.results || []);
      setTotalCount(data.count || 0);
    } catch {
      setDataEntries([]);
    }
    setDataLoading(false);
  }, [page, pageSize, dataDateRange, dataUserFilter]);

  // Load module users for tracker / filter dropdowns (admin only)
  useEffect(() => {
    if (!isAdmin) return;
    getUsersForModule('general_new').then((res) => {
      if (res.data) setModuleUsers(res.data);
    });
  }, [isAdmin]);

  useEffect(() => {
    fetchMonthEntries(calYear, calMonth);
  }, [calYear, calMonth, fetchMonthEntries]);

  // Re-fetch weekly entries when week navigation crosses month boundary
  useEffect(() => {
    const weekEndDay = addDays(weekStart, 6);
    if (weekStart.getMonth() !== calMonth || weekStart.getFullYear() !== calYear) {
      fetchMonthEntries(weekStart.getFullYear(), weekStart.getMonth());
    } else if (weekEndDay.getMonth() !== calMonth) {
      fetchMonthEntries(weekEndDay.getFullYear(), weekEndDay.getMonth());
    }
  }, [weekStart, calYear, calMonth, fetchMonthEntries]);

  useEffect(() => {
    if (activeView === 'data') fetchDataEntries();
  }, [activeView, page, pageSize, dataDateRange, dataUserFilter, fetchDataEntries]);

  const prevMonth = () => {
    if (calMonth === 0) { setCalYear(y => y - 1); setCalMonth(11); }
    else setCalMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (calMonth === 11) { setCalYear(y => y + 1); setCalMonth(0); }
    else setCalMonth(m => m + 1);
  };
  const goToday = () => { setCalYear(today.getFullYear()); setCalMonth(today.getMonth()); };

  const todayStr = toLocalDateString(today);
  const todaySubmitted = monthEntries.some(
    (e) => e.date === todayStr && e.added_by === currentUserId
  );

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
      if (activeView === 'data') fetchDataEntries();
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
      if (activeView === 'data') fetchDataEntries();
    } else {
      const data = await res.json();
      alert(data.error || 'Failed to delete entry');
    }
  };

  const openAddModal = (date?: string) => {
    setEditingEntry(null);
    setModalError('');
    setModalDate(date || todayStr);
    setIsModalOpen(true);
  };
  const openEditModal = (entry: GeneralNewEntry) => {
    setEditingEntry(entry);
    setModalError('');
    setModalDate('');
    setIsModalOpen(true);
  };

  const agentTabs: { key: 'weekly' | 'data'; label: string }[] = [
    { key: 'weekly', label: 'Weekly View' },
    { key: 'data', label: 'Data View' },
  ];

  const adminTabs: { key: typeof activeView; label: string }[] = [
    { key: 'tracker', label: 'Tracker View' },
    { key: 'weekly', label: 'Weekly View' },
    { key: 'data', label: 'Data View' },
  ];

  const dataViewContent = (
    <div className="bg-white rounded-2xl border border-[#E4E4E4] shadow-sm">
      <div className="sticky top-39 z-10 bg-white rounded-t-2xl flex items-center justify-between px-5 py-4 border-b border-[#E4E4E4] flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Select value={dataDateRange} onValueChange={(v) => { setDataDateRange(v as DateRangeOption); updateParams({ page: 1 }); }}>
            <SelectTrigger className="h-8 text-sm border-[#E4E4E4] rounded-lg px-3 w-auto min-w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Time</SelectItem>
              <SelectItem value="this_month">This Month</SelectItem>
              <SelectItem value="last_month">Last Month</SelectItem>
              <SelectItem value="this_year">This Year</SelectItem>
            </SelectContent>
          </Select>

          {isAdmin && (
            <Select value={dataUserFilter} onValueChange={(v) => { setDataUserFilter(v); updateParams({ page: 1 }); }}>
              <SelectTrigger className="h-8 text-sm border-[#E4E4E4] rounded-lg px-3 gap-1.5 w-auto min-w-[130px]">
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
          )}
        </div>

        <Button
          onClick={() => openAddModal()}
          disabled={todaySubmitted}
          title={todaySubmitted ? 'Already submitted today' : undefined}
          className="h-9 px-4 text-sm font-medium bg-[#09090B] hover:bg-[#1a1a1a] text-white rounded-lg gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus className="h-4 w-4" />
          Add record
        </Button>
      </div>

      <div className="px-5 pb-5 pt-4">
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
          height="max-h-[calc(100vh-15rem)] min-h-[200px]"
        />
      </div>
    </div>
  );

  const weeklyViewContent = (isAgentLayout: boolean) => (
    <WeeklyView
      weekStart={weekStart}
      monthEntries={monthEntries}
      today={today}
      onPrevWeek={() => setWeekStart(d => addDays(d, -7))}
      onNextWeek={() => setWeekStart(d => addDays(d, 7))}
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
    />
  );

  // ── Agent layout ─────────────────────────────────────────────────────────────
  if (!isAdmin) {
    const agentView = activeView === 'data' ? 'data' : 'weekly';
    return (
      <div className="p-6 space-y-4">
        <h1 className="text-2xl font-bold text-[#09090B]">General New</h1>

        {/* Always-visible personal Daily Tracker card */}
        <PersonalDailyTracker
          calYear={calYear}
          calMonth={calMonth}
          today={today}
          monthEntries={monthEntries}
          currentUserId={currentUserId}
          onPrevMonth={prevMonth}
          onNextMonth={nextMonth}
          onGoToday={goToday}
        />

        {/* Sticky tabs: Weekly View | Data View */}
        <div className="sticky top-16 z-20 bg-white py-2 border-b border-[#E4E4E4]">
          <div className="flex items-center gap-1">
            {agentTabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveView(tab.key)}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                  agentView === tab.key
                    ? 'bg-[#F3F4F6] text-[#09090B]'
                    : 'text-[#6B7280] hover:text-[#09090B] hover:bg-[#F9FAFB]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {agentView === 'weekly' && weeklyViewContent(true)}
        {agentView === 'data' && dataViewContent}
        {modal}
      </div>
    );
  }

  // ── Admin layout ──────────────────────────────────────────────────────────────
  return (
    <div className="p-6 space-y-5">
      {/* Sticky page header: title + tabs */}
      <div className="sticky top-16 z-20 bg-white pt-0 pb-2 border-b border-[#E4E4E4]">
        <h1 className="text-2xl font-bold text-[#09090B] pb-3">General New</h1>
        <div className="flex items-center gap-1 pb-1">
          {adminTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveView(tab.key)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                activeView === tab.key
                  ? 'bg-[#F3F4F6] text-[#09090B]'
                  : 'text-[#6B7280] hover:text-[#09090B] hover:bg-[#F9FAFB]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeView === 'tracker' && (
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
      )}
      {activeView === 'weekly' && weeklyViewContent(false)}
      {activeView === 'data' && dataViewContent}
      {modal}
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
        date: initialDate || toLocalDateString(new Date()),
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
