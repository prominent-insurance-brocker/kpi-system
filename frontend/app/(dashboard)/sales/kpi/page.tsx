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
} from 'lucide-react';
import { DateRangeFilter } from '@/components/ui/date-range-filter';
import { FormDatePicker } from '@/components/ui/form-date-picker';
import { formatDate, formatDateTime } from '@/app/lib/date';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { useConfirm } from '@/app/components/ConfirmDialog';
import {
  AddedByCell,
  PersonalDailyTracker,
  TrackerView,
  WeeklyView,
  toLocalDateString,
  startOfWeek,
  addDays,
  MONTH_NAMES,
  type BaseModuleEntry,
  type ModuleUser,
  type WeeklyColumnSpec,
} from '@/app/components/KpiModulePage';

interface SalesKPIEntry extends BaseModuleEntry {
  leads_to_ops_team: number;
  quotes_from_ops_team: number;
  quotes_to_client: number;
  total_conversions: number;
  new_clients_acquired: number;
  existing_clients: number;
  existing_clients_closed: number;
  gross_booked_premium: number;
}

interface SalesMonthlyTarget {
  id?: number;
  user?: number;
  year: number;
  month: number;
  premium_target: string | null;
  clients_assigned: number | null;
}

function formatPremium(val: number | string | null | undefined): string {
  if (val == null || val === '') return '0.00';
  const n = Number(val);
  if (!Number.isFinite(n)) return '0.00';
  return n.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ─── Weekly column config (driving the shared WeeklyView) ───────────────────

// Order mirrors the entry modal's field order: Clients & Premium →
// Lead-to-Quote → Client Retention → Quote-to-Conversion.
const weeklyColumns: WeeklyColumnSpec<SalesKPIEntry>[] = [
  { key: 'new_clients_acquired', header: 'New clients acquired' },
  {
    key: 'gross_booked_premium',
    header: 'Gross booked premium',
    render: (v) => formatPremium(v as number | string | null),
  },
  { key: 'leads_to_ops_team', header: 'Leads to ops team' },
  { key: 'quotes_from_ops_team', header: 'Quotes from ops team' },
  { key: 'existing_clients', header: 'Existing clients' },
  { key: 'existing_clients_closed', header: 'Existing clients closed' },
  { key: 'quotes_to_client', header: 'Quotes to client' },
  { key: 'total_conversions', header: 'Total conversions' },
];

// ─── Data View columns ───────────────────────────────────────────────────────

// Order mirrors the entry modal's field order: Clients & Premium →
// Lead-to-Quote → Client Retention → Quote-to-Conversion.
const dataColumns = [
  { key: 'date', header: 'Record date', render: (item: SalesKPIEntry) => formatDate(item.date) },
  {
    key: 'new_clients_acquired',
    header: 'New clients acquired',
    tooltip: 'Number of new clients acquired',
  },
  {
    key: 'gross_booked_premium',
    header: 'Gross booked premium',
    render: (item: SalesKPIEntry) => formatPremium(item.gross_booked_premium),
  },
  {
    key: 'leads_to_ops_team',
    header: 'Leads to ops team',
    tooltip: 'Number of leads handed over to the operations team',
  },
  {
    key: 'quotes_from_ops_team',
    header: 'Quotes from ops team',
    tooltip: 'Number of quotes received from the operations team',
  },
  {
    key: 'existing_clients',
    header: 'Existing clients',
    tooltip: 'Number of existing clients under my account',
  },
  {
    key: 'existing_clients_closed',
    header: 'Existing clients closed',
    tooltip: 'How many existing clients did I close',
  },
  {
    key: 'quotes_to_client',
    header: 'Quotes to client',
    tooltip: 'Number of quotes submitted to the client',
  },
  {
    key: 'total_conversions',
    header: 'Total conversions',
    tooltip: 'Total number of conversions',
  },
  { key: 'added_by_name', header: 'Added by', render: (item: SalesKPIEntry) => <AddedByCell entry={item} /> },
  {
    key: 'added_at',
    header: 'Added on',
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
    if (!currentUserId) return;
    const targetResult = await fetchApi<{ results: SalesMonthlyTarget[] }>(
      `/api/entries/sales-kpi/monthly-targets/?year=${cardYear}&month=${cardMonth}`
    );
    setCardTarget(targetResult.data?.results?.[0] ?? null);

    // Monthly Target progress is always personal — scope to the logged-in user
    // even when admins (who can see all data) are viewing the page.
    const firstDay = `${cardYear}-${String(cardMonth).padStart(2, '0')}-01`;
    const lastDay = toLocalDateString(new Date(cardYear, cardMonth, 0));
    const result = await fetchApi<{ results: SalesKPIEntry[] }>(
      `/api/entries/sales-kpi/?date_from=${firstDay}&date_to=${lastDay}&user_id=${currentUserId}&page_size=1000`
    );
    setCardEntries(result.data?.results ?? []);
  }, [cardYear, cardMonth, currentUserId]);

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

  const fetchEntriesForMonths = useCallback(
    async (months: Array<[number, number]>) => {
      try {
        const unique = Array.from(new Set(months.map(([y, m]) => `${y}-${m}`))).map((s) => {
          const [y, m] = s.split('-').map(Number);
          return [y, m] as [number, number];
        });
        const responses = await Promise.all(
          unique.map(([year, month]) => {
            const firstDay = `${year}-${String(month + 1).padStart(2, '0')}-01`;
            const lastDay = toLocalDateString(new Date(year, month + 1, 0));
            const params = new URLSearchParams({
              date_from: firstDay,
              date_to: lastDay,
              page_size: '1000',
            });
            return fetchApi<{ results: SalesKPIEntry[] }>(`/api/entries/sales-kpi/?${params}`);
          })
        );
        const merged = new Map<number, SalesKPIEntry>();
        for (const res of responses) {
          for (const entry of res.data?.results ?? []) {
            merged.set(entry.id, entry);
          }
        }
        setMonthEntries(Array.from(merged.values()));
      } catch {
        setMonthEntries([]);
      }
    },
    []
  );

  const fetchMonthEntries = useCallback(
    (year: number, month: number) => fetchEntriesForMonths([[year, month]]),
    [fetchEntriesForMonths]
  );

  const fetchSheetTargets = useCallback(async () => {
    const result = await fetchApi<{ results: SalesMonthlyTarget[] }>(
      `/api/entries/sales-kpi/monthly-targets/?year=${sheetYear}`
    );
    setSheetTargets(result.data?.results ?? []);
  }, [sheetYear]);

  // Load module users for admin (used by Tracker, Weekly, and Data user filters).
  // Default the weekly user filter to the logged-in user so the admin lands on
  // their own week rather than the alphabetically-first agent's.
  useEffect(() => {
    if (!isAdmin) return;
    getUsersForModule('sales_kpi').then((result) => {
      if (result.data) {
        setModuleUsers(result.data);
        if (currentUserId) {
          setWeeklyUserFilter(String(currentUserId));
        } else if (result.data.length > 0) {
          setWeeklyUserFilter(String(result.data[0].id));
        }
      }
    });
  }, [isAdmin, currentUserId]);

  useEffect(() => {
    fetchCurrentTarget();
  }, [fetchCurrentTarget]);

  useEffect(() => {
    if (currentTargetLoaded) fetchCardData();
  }, [cardYear, cardMonth, currentTargetLoaded, fetchCardData]);

  // Single coordinated fetch: pulls every month any visible view needs
  // (Daily Tracker month, plus the months the current week straddles) and
  // merges the results so neither side overwrites the other.
  useEffect(() => {
    const weekEndDay = addDays(weekStart, 6);
    fetchEntriesForMonths([
      [calYear, calMonth],
      [weekStart.getFullYear(), weekStart.getMonth()],
      [weekEndDay.getFullYear(), weekEndDay.getMonth()],
    ]);
  }, [calYear, calMonth, weekStart, fetchEntriesForMonths]);

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
                deptLabel="Sales KPI DEPT."
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
              weeklyColumns={weeklyColumns}
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
                  {(dateFrom || dateTo || userId) && (
                    <Button
                      variant="outline"
                      onClick={() => updateFilters({ dateFrom: '', dateTo: '', userId: '', page: 1 })}
                    >
                      Clear Filters
                    </Button>
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
                              min={tab === 'premium' ? '0.01' : '1'}
                              step={tab === 'premium' ? '0.01' : '1'}
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
                    New clients acquired
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
                    Gross booked premium
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
                    Leads to ops team
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
                    Quotes from ops team
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
                    Existing clients
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
                    Existing clients closed
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
                    Quotes to client
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
                    Total conversions
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
              min="0.01"
              step="0.01"
              placeholder="e.g. 150.00"
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
