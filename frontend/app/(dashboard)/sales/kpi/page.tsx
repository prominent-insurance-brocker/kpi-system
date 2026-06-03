'use client';

/**
 * Sales KPI — per-ticket enquiry workflow (TED-446 + TED-447).
 *
 * Replaces the original per-day KPI counter page. Each row is a single sales
 * enquiry ticket with customer_name + class_of_insurance + assignee +
 * potential_premium and a status state machine
 * (lead → in_progress → won/lost). Transitions out of `in_progress` go
 * through SalesKPIStatusModal (TED-447) which captures workflow flags and
 * Converted Premium for won.
 *
 * The Monthly Target side panel and Monthly Target progress card are
 * preserved unchanged in shape — they still drive premium / clients_assigned
 * targets from SalesMonthlyTarget. Card progress now reads:
 *   - Premium actual = sum(converted_premium) for the month's won tickets.
 *   - Clients actual = count of won tickets for the month.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Pencil,
  Calendar,
  X,
  Check,
  FileText,
} from 'lucide-react';
import { toast } from 'sonner';

import { DataTable } from '@/app/components/DataTable';
import { FilterBar } from '@/app/components/FilterBar';
import { RemarksPanel } from '@/app/components/RemarksPanel';
import { FormDatePicker } from '@/components/ui/form-date-picker';
import { formatDate } from '@/app/lib/date';
import { useAuth } from '@/app/context/AuthContext';
import { useConfirm } from '@/app/components/ConfirmDialog';
import {
  AddedByCell,
  MONTH_NAMES,
  PersonalDailyTracker,
  TrackerView,
  type ModuleUser,
} from '@/app/components/KpiModulePage';
import { SalesKPIStatusModal } from '@/app/components/SalesKPIStatusModal';
import {
  fetchApi,
  getSalesKPIStats,
  getUsersForModule,
  getUsersForModulePage,
  getClassOfInsurancePage,
  getRemarksContentTypes,
  REMARKS_MODEL_NAME_BY_API_SLUG,
  type SalesKPIEntry,
  type SalesKPIStats,
  type SalesKPIStatus,
  type SalesKPIEntryType,
} from '@/app/lib/api';

interface SalesMonthlyTarget {
  id?: number;
  user?: number;
  year: number;
  month: number;
  premium_target: string | null;
  clients_assigned: number | null;
}

const STATUS_OPTIONS: Array<{ value: SalesKPIStatus; label: string }> = [
  { value: 'lead', label: 'Lead' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
];

const TYPE_OPTIONS: Array<{ value: SalesKPIEntryType; label: string }> = [
  { value: 'new', label: 'New' },
  { value: 'renewal', label: 'Renewal' },
];

const STATUS_LABEL: Record<SalesKPIStatus, string> = {
  lead: 'Lead',
  in_progress: 'In Progress',
  won: 'Won',
  lost: 'Lost',
};

const STATUS_BADGE_CLASSES: Record<SalesKPIStatus, string> = {
  lead: 'bg-blue-100 text-blue-800',
  in_progress: 'bg-amber-100 text-amber-800',
  won: 'bg-green-100 text-green-800',
  lost: 'bg-gray-200 text-gray-700',
};

function formatPremium(val: number | string | null | undefined): string {
  if (val == null || val === '') return '0.00';
  const n = Number(val);
  if (!Number.isFinite(n)) return '0.00';
  return n.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SalesKPIPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { canSeeAllData, user, isHOD } = useAuth();
  const confirm = useConfirm();

  const isAdmin = canSeeAllData();
  const isHodUser = isHOD();
  const currentUserId = user?.id;

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  // Tabs
  const [activeView, setActiveView] = useState<'dashboard' | 'tracker' | 'enquiries'>(
    'enquiries',
  );

  // Dashboard-tab filters — kept independent of the URL-synced Enquiries
  // filters so the two tabs don't fight each other.
  const [dashFrom, setDashFrom] = useState('');
  const [dashTo, setDashTo] = useState('');
  const [dashUserId, setDashUserId] = useState('');

  // Tracker tab state — independent calendars so paging the tracker doesn't
  // move the Monthly Target card (cardYear/cardMonth) and vice-versa.
  const [monthEntries, setMonthEntries] = useState<SalesKPIEntry[]>([]);
  const [moduleUsers, setModuleUsers] = useState<ModuleUser[]>([]);
  const [trackerUserFilter, setTrackerUserFilter] = useState('all');
  const [personalCalYear, setPersonalCalYear] = useState(today.getFullYear());
  const [personalCalMonth, setPersonalCalMonth] = useState(today.getMonth());
  const [teamCalYear, setTeamCalYear] = useState(today.getFullYear());
  const [teamCalMonth, setTeamCalMonth] = useState(today.getMonth());

  // Modals
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<SalesKPIEntry | null>(null);
  const [modalError, setModalError] = useState('');

  const [statusModalEntry, setStatusModalEntry] = useState<SalesKPIEntry | null>(null);
  const [statusModalNext, setStatusModalNext] = useState<SalesKPIStatus | null>(null);

  // Remarks side panel (same UX as the other modules — opens on the Notes
  // button in each row). saleskpientry is registered in ALLOWED_REMARK_MODELS.
  const [panelEntry, setPanelEntry] = useState<SalesKPIEntry | null>(null);
  const [ctMap, setCtMap] = useState<Record<string, number>>({});
  useEffect(() => {
    getRemarksContentTypes().then((res) => {
      if (res.data) setCtMap(res.data);
    });
  }, []);
  const remarksContentTypeId = ctMap[REMARKS_MODEL_NAME_BY_API_SLUG['sales-kpi']] ?? null;

  // Filters (URL-synced)
  const page = Number(searchParams.get('page')) || 1;
  const pageSize = Number(searchParams.get('pageSize')) || 20;
  const dateFrom = searchParams.get('dateFrom') || '';
  const dateTo = searchParams.get('dateTo') || '';
  const userId = searchParams.get('userId') || '';
  const assigneeId = searchParams.get('assignee') || '';
  const statusFilter = searchParams.get('status') || '';
  const classFilter = searchParams.get('class_of_insurance') || '';
  const typeFilter = searchParams.get('entry_type') || '';

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

  // Data
  const [entries, setEntries] = useState<SalesKPIEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [stats, setStats] = useState<SalesKPIStats | null>(null);

  // Monthly target card
  const [currentTarget, setCurrentTarget] = useState<SalesMonthlyTarget | null>(null);
  const [currentTargetLoaded, setCurrentTargetLoaded] = useState(false);
  const [isTargetModalOpen, setIsTargetModalOpen] = useState(false);
  const [cardYear, setCardYear] = useState(today.getFullYear());
  const [cardMonth, setCardMonth] = useState(today.getMonth() + 1);
  const [cardTarget, setCardTarget] = useState<SalesMonthlyTarget | null>(null);
  const [cardEntries, setCardEntries] = useState<SalesKPIEntry[]>([]);

  // Monthly Targets side panel
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [sheetYear, setSheetYear] = useState(today.getFullYear());
  const [sheetTargets, setSheetTargets] = useState<SalesMonthlyTarget[]>([]);
  const [sheetInlineValues, setSheetInlineValues] = useState<Record<string, string>>({});
  const [sheetEditingKey, setSheetEditingKey] = useState<string | null>(null);

  // ── Fetchers ──────────────────────────────────────────────────────────────

  const fetchEntries = useCallback(async () => {
    setIsLoading(true);
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('page_size', String(pageSize));
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    if (userId) params.set('user_id', userId);
    if (assigneeId) params.set('assignee', assigneeId);
    if (statusFilter) params.set('status', statusFilter);
    if (classFilter) params.set('class_of_insurance', classFilter);
    if (typeFilter) params.set('entry_type', typeFilter);
    const result = await fetchApi<{ results: SalesKPIEntry[]; count: number }>(
      `/api/entries/sales-kpi/?${params}`,
    );
    setEntries(result.data?.results ?? []);
    setTotalCount(result.data?.count ?? 0);
    setIsLoading(false);
  }, [
    page, pageSize, dateFrom, dateTo, userId, assigneeId,
    statusFilter, classFilter, typeFilter,
  ]);

  const fetchStats = useCallback(async () => {
    // Dashboard cards are scoped by the dashboard-tab FilterBar (date range +
    // user), independent of the Enquiries-tab URL-synced filters.
    const result = await getSalesKPIStats({
      date_from: dashFrom || undefined,
      date_to: dashTo || undefined,
      user_id: dashUserId || undefined,
    });
    if (result.data) setStats(result.data);
  }, [dashFrom, dashTo, dashUserId]);

  const fetchCurrentTarget = useCallback(async () => {
    const y = today.getFullYear();
    const m = today.getMonth() + 1;
    const result = await fetchApi<{ results: SalesMonthlyTarget[] }>(
      `/api/entries/sales-kpi/monthly-targets/?year=${y}&month=${m}`,
    );
    setCurrentTarget(result.data?.results?.[0] ?? null);
    setCurrentTargetLoaded(true);
  }, [today]);

  // TED-464 view selector. Drives both the Monthly Target progress card and
  // the actuals derivation below. Values:
  //   'team' → aggregated across all users (HOD + admin default)
  //   'my'   → the viewer's own data (admin only — HOD has no personal data)
  //   '<id>' → a specific user's data (admin/HOD individual toggle)
  // Regular users never see the dropdown and stay on a personal-only path.
  const isAggregator = isHodUser || !!user?.is_staff;
  const [cardView, setCardView] = useState<string>(() =>
    isHodUser ? 'team' : user?.is_staff ? 'team' : 'my',
  );

  // Resolve the view selection into a concrete user_id (or empty for team).
  const cardViewUserId =
    cardView === 'team'
      ? ''
      : cardView === 'my'
        ? (currentUserId ? String(currentUserId) : '')
        : cardView;

  // True when the target row currently displayed belongs to the viewer
  // (regular user, or aggregator on the 'my' scope). Drives Edit-button
  // visibility on the small card AND inline-edit affordances in the side
  // panel — both must stay read-only when team-aggregated or another user's
  // row is on screen, since the backend's perform_create always binds new
  // rows to request.user and team aggregates have no id to PATCH against.
  const isOwnTargetView = !isAggregator || cardView === 'my';

  const fetchCardData = useCallback(async () => {
    if (!currentUserId) return;
    // Targets endpoint: aggregator + user_id → that user's row; aggregator
    // without user_id → team-summed; regular user → own (server enforces).
    const targetQs = new URLSearchParams({
      year: String(cardYear),
      month: String(cardMonth),
    });
    if (cardViewUserId) targetQs.set('user_id', cardViewUserId);
    const targetResult = await fetchApi<{ results: SalesMonthlyTarget[] }>(
      `/api/entries/sales-kpi/monthly-targets/?${targetQs}`,
    );
    setCardTarget(targetResult.data?.results?.[0] ?? null);

    const firstDay = `${cardYear}-${String(cardMonth).padStart(2, '0')}-01`;
    const lastDay = toLocalDateString(new Date(cardYear, cardMonth, 0));
    // Match the target scope: team-aggregated rows pair with team-wide
    // actuals, personal targets pair with personal actuals.
    const userFilter = cardViewUserId ? `&user_id=${cardViewUserId}` : '';
    const result = await fetchApi<{ results: SalesKPIEntry[] }>(
      `/api/entries/sales-kpi/?date_from=${firstDay}&date_to=${lastDay}${userFilter}&page_size=1000`,
    );
    setCardEntries(result.data?.results ?? []);
  }, [cardYear, cardMonth, currentUserId, cardViewUserId]);

  const fetchSheetTargets = useCallback(async () => {
    const qs = new URLSearchParams({ year: String(sheetYear) });
    if (cardViewUserId) qs.set('user_id', cardViewUserId);
    const result = await fetchApi<{ results: SalesMonthlyTarget[] }>(
      `/api/entries/sales-kpi/monthly-targets/?${qs}`,
    );
    setSheetTargets(result.data?.results ?? []);
  }, [sheetYear, cardViewUserId]);

  // Wide-window fetch for the Tracker tab — pulls every entry visible to the
  // user (the backend already scopes by data_visibility) for the months the
  // personal + team calendars currently show. De-duped by id since the two
  // calendars may overlap.
  const fetchMonthEntries = useCallback(async () => {
    const months: Array<[number, number]> = [
      [personalCalYear, personalCalMonth],
      [teamCalYear, teamCalMonth],
    ];
    const unique = Array.from(new Set(months.map(([y, m]) => `${y}-${m}`))).map((s) => {
      const [y, m] = s.split('-').map(Number);
      return [y, m] as [number, number];
    });
    try {
      const responses = await Promise.all(
        unique.map(([year, month]) => {
          const firstDay = `${year}-${String(month + 1).padStart(2, '0')}-01`;
          const lastDay = toLocalDateString(new Date(year, month + 1, 0));
          const qs = new URLSearchParams({
            date_from: firstDay,
            date_to: lastDay,
            page_size: '1000',
          });
          return fetchApi<{ results: SalesKPIEntry[] }>(
            `/api/entries/sales-kpi/?${qs}`,
          );
        }),
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
  }, [personalCalYear, personalCalMonth, teamCalYear, teamCalMonth]);

  useEffect(() => { fetchCurrentTarget(); }, [fetchCurrentTarget]);
  useEffect(() => {
    if (currentTargetLoaded) fetchCardData();
  }, [cardYear, cardMonth, currentTargetLoaded, fetchCardData]);
  useEffect(() => { fetchEntries(); }, [fetchEntries]);
  useEffect(() => { fetchStats(); }, [fetchStats]);
  useEffect(() => {
    if (isPanelOpen) fetchSheetTargets();
  }, [isPanelOpen, sheetYear, fetchSheetTargets]);
  // Cancel any in-progress month-row edit when the scope or year changes — the
  // edited value would otherwise be orphaned against the freshly-fetched
  // (possibly read-only) target set.
  useEffect(() => {
    setSheetEditingKey(null);
    setSheetInlineValues({});
  }, [cardViewUserId, sheetYear]);
  // Load the team-view user list once. The TrackerView's filter dropdown and
  // the per-user row labels both read from this.
  useEffect(() => {
    getUsersForModule('sales_kpi').then((r) => {
      if (r.data) setModuleUsers(r.data);
    });
  }, []);
  // Refetch the tracker month window whenever the tab is active or either
  // calendar is paged.
  useEffect(() => {
    if (activeView === 'tracker') fetchMonthEntries();
  }, [activeView, fetchMonthEntries]);

  const refreshAll = () => {
    fetchEntries();
    fetchStats();
    fetchCardData();
    if (activeView === 'tracker') fetchMonthEntries();
  };

  // ── Monthly target card aggregates ───────────────────────────────────────

  const cardPremiumActual = cardEntries
    .filter((e) => e.status === 'won')
    .reduce((sum, e) => sum + Number(e.converted_premium ?? 0), 0);
  // Client Retention counts only Renewal-type tickets that closed as Won —
  // a New deal is acquisition, not retention.
  const cardClientsActual = cardEntries.filter(
    (e) => e.status === 'won' && e.entry_type === 'renewal',
  ).length;
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
  // HODs and super admins (is_staff) don't carry personal monthly targets,
  // so the "Set this month's target" gate is skipped for both.
  const noCurrentTarget =
    !isHodUser && !user?.is_staff && currentTargetLoaded && !currentTarget;
  const targetForModal: SalesMonthlyTarget | null = isCurrentMonthCard ? currentTarget : cardTarget;

  useEffect(() => {
    if (noCurrentTarget) setIsTargetModalOpen(true);
  }, [noCurrentTarget]);

  // ── Mutations ─────────────────────────────────────────────────────────────

  const openAddModal = () => {
    if (noCurrentTarget) {
      setIsTargetModalOpen(true);
      return;
    }
    setEditingEntry(null);
    setModalError('');
    setIsModalOpen(true);
  };

  const openEditModal = (entry: SalesKPIEntry) => {
    setEditingEntry(entry);
    setModalError('');
    setIsModalOpen(true);
  };

  const handleSaveEntry = async (payload: Record<string, unknown>) => {
    setModalError('');
    const isEdit = !!editingEntry;
    const url = isEdit
      ? `/api/entries/sales-kpi/${editingEntry!.id}/`
      : `/api/entries/sales-kpi/`;
    const body = isEdit
      ? payload
      : { date: toLocalDateString(today), ...payload };
    const result = await fetchApi<SalesKPIEntry>(url, {
      method: isEdit ? 'PATCH' : 'POST',
      body: JSON.stringify(body),
    });
    if (result.data) {
      setIsModalOpen(false);
      setEditingEntry(null);
      toast.success(isEdit ? 'Enquiry updated' : 'Enquiry added');
      refreshAll();
    } else {
      setModalError(result.error || 'Failed to save enquiry');
    }
  };

  const handleDeleteEntry = async (entry: SalesKPIEntry) => {
    const ok = await confirm({
      title: 'Delete enquiry?',
      description: 'This action cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    const result = await fetchApi<void>(`/api/entries/sales-kpi/${entry.id}/`, {
      method: 'DELETE',
    });
    if (!result.error) {
      toast.success('Enquiry deleted');
      if (panelEntry?.id === entry.id) setPanelEntry(null);
      refreshAll();
    } else {
      toast.error(result.error || 'Failed to delete enquiry');
    }
  };

  const handleStatusChange = (entry: SalesKPIEntry, next: SalesKPIStatus) => {
    setStatusModalEntry(entry);
    setStatusModalNext(next);
  };

  // ── Columns ───────────────────────────────────────────────────────────────

  const columns = [
    { key: 'pib_id', header: 'ID', render: (item: SalesKPIEntry) => item.pib_id },
    { key: 'date', header: 'Date', render: (item: SalesKPIEntry) => formatDate(item.date) },
    { key: 'customer_name', header: 'Customer Name' },
    {
      key: 'entry_type',
      header: 'Type',
      render: (item: SalesKPIEntry) => item.entry_type_display,
    },
    {
      key: 'class_of_insurance',
      header: 'Class of Insurance',
      render: (item: SalesKPIEntry) => item.class_of_insurance_name || '—',
    },
    { key: 'assignee', header: 'Assignee', render: (item: SalesKPIEntry) => item.assignee_name },
    {
      key: 'potential_premium',
      header: 'Potential Premium',
      render: (item: SalesKPIEntry) => formatPremium(item.potential_premium),
    },
    {
      key: 'converted_premium',
      header: 'Converted Premium',
      render: (item: SalesKPIEntry) =>
        item.converted_premium != null ? formatPremium(item.converted_premium) : '—',
    },
    {
      key: 'status',
      header: 'Status',
      render: (item: SalesKPIEntry) =>
        item.is_terminal || item.allowed_transitions.length === 0 ? (
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE_CLASSES[item.status]}`}
          >
            {STATUS_LABEL[item.status]}
          </span>
        ) : (
          <Select
            value={item.status}
            onValueChange={(v) => handleStatusChange(item, v as SalesKPIStatus)}
          >
            <SelectTrigger className="h-8 w-[140px] text-xs shadow-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={item.status} disabled>
                {STATUS_LABEL[item.status]}
              </SelectItem>
              {item.allowed_transitions.map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ),
    },
    {
      key: 'added_by_name',
      header: 'Added by',
      render: (item: SalesKPIEntry) => <AddedByCell entry={item} />,
    },
    {
      key: 'notes',
      header: 'Notes',
      render: (item: SalesKPIEntry) => (
        <button
          type="button"
          onClick={() => setPanelEntry(item)}
          className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-[#F3F3F3]"
          aria-label="View remarks"
        >
          <FileText className="h-4 w-4 text-[#71717A]" />
        </button>
      ),
    },
  ];

  // ── Side panel helpers (unchanged from prior page) ───────────────────────

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
          : 'Assigned clients must be greater than 0',
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
    if (sheetYear === today.getFullYear() && month === today.getMonth() + 1) {
      fetchCurrentTarget();
    }
    if (sheetYear === cardYear && month === cardMonth) {
      fetchCardData();
    }
  };

  // ── Filter pickers (class_of_insurance + assignee) ──────────────────────

  const classOfInsuranceFetchPage = useCallback(
    async ({ search, page: p }: { search: string; page: number }) => {
      const res = await getClassOfInsurancePage({ search, page: p });
      return {
        results: res.data?.results ?? [],
        hasMore: res.data?.has_more ?? false,
      };
    },
    [],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  const hasActiveFilters = !!(
    dateFrom || dateTo || userId || assigneeId || statusFilter || classFilter || typeFilter
  );

  return (
    <div className="p-6 flex gap-6 items-start">
      <div className="flex-1 min-w-0 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Deals</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setIsPanelOpen((o) => !o)}>
              <Pencil className="h-4 w-4 mr-2" /> Monthly Targets
            </Button>
            <Button
              onClick={openAddModal}
              disabled={noCurrentTarget}
              title={noCurrentTarget ? 'Set monthly targets first' : undefined}
            >
              <Plus className="h-4 w-4 mr-2" /> Add Enquiry
            </Button>
          </div>
        </div>

        {/* Monthly Target progress card */}
        <div className="border rounded-lg p-4 space-y-2 bg-white w-[362px]">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold">Monthly Target</h2>
            {isAggregator && (
              <Select value={cardView} onValueChange={setCardView}>
                <SelectTrigger className="w-[140px] shadow-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {user?.is_staff && <SelectItem value="my">My Deals</SelectItem>}
                  <SelectItem value="team">Team Deals</SelectItem>
                  {moduleUsers
                    .filter((u) => u.id !== currentUserId)
                    .map((u) => (
                      <SelectItem key={u.id} value={String(u.id)}>
                        {u.full_name || u.email}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-1">
              <div className="flex items-baseline justify-between">
                <span className="text-xl font-bold">{formatPremium(cardPremiumActual)}</span>
                <span className="text-sm text-muted-foreground">Premium</span>
              </div>
              <div className="relative">
                <div
                  className={
                    premiumTarget !== null && cardPremiumActual >= premiumTarget
                      ? '[&_[data-slot=progress-indicator]]:bg-green-500'
                      : '[&_[data-slot=progress-indicator]]:bg-red-400'
                  }
                >
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
            <div className="space-y-1">
              <div className="flex items-baseline justify-between">
                <span className="text-xl font-bold">{cardClientsActual.toLocaleString()}</span>
                <span className="text-sm text-muted-foreground">Client Retention</span>
              </div>
              <div className="relative">
                <div
                  className={
                    clientsTarget !== null && cardClientsActual >= clientsTarget
                      ? '[&_[data-slot=progress-indicator]]:bg-green-500'
                      : '[&_[data-slot=progress-indicator]]:bg-red-400'
                  }
                >
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
                    <span className="text-muted-foreground">
                      {Math.round(clientsTarget).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
          <h3 className="text-xl font-semibold">{MONTH_NAMES[cardMonth - 1]}</h3>
          <div className="flex items-center gap-2">
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
              <Calendar className="h-3 w-3 mr-1" /> Today
            </Button>
            {isOwnTargetView && (
              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
                onClick={() => setIsTargetModalOpen(true)}
              >
                <Pencil className="h-3 w-3 mr-1" /> Edit
              </Button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <Tabs
          value={activeView}
          onValueChange={(v) =>
            setActiveView(v as 'dashboard' | 'tracker' | 'enquiries')
          }
        >
          <TabsList className="bg-[#F3F4F6] rounded-lg p-1 gap-0 w-fit">
            <TabsTrigger
              value="dashboard"
              className="px-4 py-1.5 text-sm font-medium rounded-lg data-[state=active]:bg-white data-[state=active]:text-[#09090B] data-[state=active]:border data-[state=active]:border-[#E4E4E4] data-[state=active]:shadow-none data-[state=inactive]:bg-transparent data-[state=inactive]:text-[#6B7280]"
            >
              Dashboard
            </TabsTrigger>
            <TabsTrigger
              value="tracker"
              className="px-4 py-1.5 text-sm font-medium rounded-lg data-[state=active]:bg-white data-[state=active]:text-[#09090B] data-[state=active]:border data-[state=active]:border-[#E4E4E4] data-[state=active]:shadow-none data-[state=inactive]:bg-transparent data-[state=inactive]:text-[#6B7280]"
            >
              Tracker
            </TabsTrigger>
            <TabsTrigger
              value="enquiries"
              className="px-4 py-1.5 text-sm font-medium rounded-lg data-[state=active]:bg-white data-[state=active]:text-[#09090B] data-[state=active]:border data-[state=active]:border-[#E4E4E4] data-[state=active]:shadow-none data-[state=inactive]:bg-transparent data-[state=inactive]:text-[#6B7280]"
            >
              Enquiries
            </TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard" className="mt-4 space-y-4">
            <FilterBar
              dateRange={{
                from: dashFrom,
                to: dashTo,
                onChange: (from, to) => { setDashFrom(from); setDashTo(to); },
              }}
              user={
                isAdmin
                  ? {
                      value: dashUserId,
                      onChange: (v) => setDashUserId(v),
                      moduleKey: 'sales_kpi',
                      selectedLabel:
                        moduleUsers.find((u) => String(u.id) === dashUserId)?.full_name ?? null,
                    }
                  : undefined
              }
              hasActiveFilters={!!(dashFrom || dashTo || dashUserId)}
              onClear={() => { setDashFrom(''); setDashTo(''); setDashUserId(''); }}
            />
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
              <StatCard title="Total Enquiries" value={stats?.total ?? 0} />
              <StatCard title="Lead" value={stats?.lead ?? 0} accent="text-blue-600" />
              <StatCard title="In Progress" value={stats?.in_progress ?? 0} accent="text-amber-600" />
              <StatCard title="Won" value={stats?.won ?? 0} accent="text-green-600" />
              <StatCard title="Lost" value={stats?.lost ?? 0} accent="text-gray-600" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <StatCard
                title="Total Potential Premium"
                value={formatPremium(stats?.potential_premium_total ?? 0)}
                isCurrency
              />
              <StatCard
                title="Converted Premium"
                value={formatPremium(stats?.converted_premium_total ?? 0)}
                accent="text-green-600"
                isCurrency
              />
            </div>
          </TabsContent>

          {/* ─── Tracker tab ─────────────────────────────────────────── */}
          <TabsContent value="tracker" className="mt-4 space-y-4">
            {!isHodUser && (
              <PersonalDailyTracker<SalesKPIEntry>
                calYear={personalCalYear}
                calMonth={personalCalMonth}
                today={today}
                monthEntries={monthEntries}
                currentUserId={currentUserId}
                userFullName={user?.full_name || ''}
                onPrevMonth={() => {
                  if (personalCalMonth === 0) {
                    setPersonalCalMonth(11);
                    setPersonalCalYear((y) => y - 1);
                  } else {
                    setPersonalCalMonth((m) => m - 1);
                  }
                }}
                onNextMonth={() => {
                  if (personalCalMonth === 11) {
                    setPersonalCalMonth(0);
                    setPersonalCalYear((y) => y + 1);
                  } else {
                    setPersonalCalMonth((m) => m + 1);
                  }
                }}
                onGoToday={() => {
                  setPersonalCalYear(today.getFullYear());
                  setPersonalCalMonth(today.getMonth());
                }}
              />
            )}
            {(isAdmin || isHodUser) && (
              <TrackerView<SalesKPIEntry>
                calYear={teamCalYear}
                calMonth={teamCalMonth}
                monthEntries={monthEntries}
                moduleUsers={moduleUsers}
                trackerUserFilter={trackerUserFilter}
                onTrackerUserFilterChange={setTrackerUserFilter}
                excludeUserId={isHodUser ? currentUserId : undefined}
                onPrevMonth={() => {
                  if (teamCalMonth === 0) {
                    setTeamCalMonth(11);
                    setTeamCalYear((y) => y - 1);
                  } else {
                    setTeamCalMonth((m) => m - 1);
                  }
                }}
                onNextMonth={() => {
                  if (teamCalMonth === 11) {
                    setTeamCalMonth(0);
                    setTeamCalYear((y) => y + 1);
                  } else {
                    setTeamCalMonth((m) => m + 1);
                  }
                }}
                onGoToday={() => {
                  setTeamCalYear(today.getFullYear());
                  setTeamCalMonth(today.getMonth());
                }}
              />
            )}
          </TabsContent>

          <TabsContent value="enquiries" className="mt-4 space-y-4">
            <FilterBar
              dateRange={{
                from: dateFrom,
                to: dateTo,
                onChange: (from, to) =>
                  updateFilters({ dateFrom: from, dateTo: to, page: 1 }),
              }}
              user={isAdmin ? {
                value: userId,
                onChange: (v) => updateFilters({ userId: v, page: 1 }),
                moduleKey: 'sales_kpi',
                placeholder: 'All Users',
              } : undefined}
              agent={{
                value: assigneeId,
                onChange: (v) => updateFilters({ assignee: v, page: 1 }),
                moduleKey: 'sales_kpi',
                label: 'Assignee',
                placeholder: 'All Assignees',
              }}
              status={{
                value: statusFilter,
                onChange: (v) => updateFilters({ status: v, page: 1 }),
                options: STATUS_OPTIONS,
                placeholder: 'All Statuses',
              }}
              extraSearchableFilters={[
                {
                  label: 'Class of Insurance',
                  value: classFilter,
                  onChange: (v) => updateFilters({ class_of_insurance: v, page: 1 }),
                  fetchPage: classOfInsuranceFetchPage,
                },
              ]}
              extraSelects={[
                {
                  label: 'Type',
                  value: typeFilter,
                  onChange: (v) => updateFilters({ entry_type: v, page: 1 }),
                  // First option is the "clear" — selecting it clears the URL param.
                  options: [
                    { value: 'all', label: 'All' },
                    ...TYPE_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label })),
                  ],
                  placeholder: 'All Types',
                },
              ]}
              hasActiveFilters={hasActiveFilters}
              onClear={() =>
                updateFilters({
                  dateFrom: '', dateTo: '', userId: '', assignee: '',
                  status: '', class_of_insurance: '', entry_type: '', page: 1,
                })
              }
            />

            <div className="flex gap-4">
              <div className="flex-1 min-w-0">
                <DataTable
                  columns={columns}
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
              <RemarksPanel
                contentTypeId={remarksContentTypeId}
                objectId={panelEntry?.id ?? null}
                entryLabel={panelEntry ? `Deals — ${panelEntry.pib_id}` : ''}
                open={!!panelEntry}
                onOpenChange={(open) => {
                  if (!open) setPanelEntry(null);
                }}
              />
            </div>
          </TabsContent>
        </Tabs>

        {/* Add/Edit modal */}
        <EntryModal
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            setEditingEntry(null);
            setModalError('');
          }}
          onSave={handleSaveEntry}
          entry={editingEntry}
          error={modalError}
        />

        {/* TED-447 status modal */}
        <SalesKPIStatusModal
          isOpen={!!statusModalEntry && !!statusModalNext}
          onClose={() => {
            setStatusModalEntry(null);
            setStatusModalNext(null);
          }}
          entry={statusModalEntry}
          nextStatus={statusModalNext}
          onSaved={() => refreshAll()}
        />

        {/* Set/Edit Targets modal */}
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

      {/* Monthly Targets side panel — unchanged shape from prior implementation. */}
      {isPanelOpen && (
        <div className="w-[340px] shrink-0 border rounded-lg overflow-hidden bg-white">
          <div className="flex items-start justify-between px-4 py-3 border-b">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-base text-[#09090B]">Monthly Targets</h3>
                {isAggregator ? (
                  <Select value={cardView} onValueChange={setCardView}>
                    <SelectTrigger className="w-[140px] h-7 shadow-none text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {user?.is_staff && <SelectItem value="my">My Deals</SelectItem>}
                      <SelectItem value="team">Team Deals</SelectItem>
                      {moduleUsers
                        .filter((u) => u.id !== currentUserId)
                        .map((u) => (
                          <SelectItem key={u.id} value={String(u.id)}>
                            {u.full_name || u.email}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-100 text-emerald-700">
                    My Target
                  </span>
                )}
              </div>
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
                  className="px-4 py-1.5 text-sm font-medium rounded-lg data-[state=active]:bg-white data-[state=active]:text-[#09090B] data-[state=active]:border data-[state=active]:border-[#E4E4E4] data-[state=active]:shadow-none data-[state=inactive]:bg-transparent data-[state=inactive]:text-[#6B7280]"
                >
                  Premium
                </TabsTrigger>
                <TabsTrigger
                  value="clients"
                  className="px-4 py-1.5 text-sm font-medium rounded-lg data-[state=active]:bg-white data-[state=active]:text-[#09090B] data-[state=active]:border data-[state=active]:border-[#E4E4E4] data-[state=active]:shadow-none data-[state=inactive]:bg-transparent data-[state=inactive]:text-[#6B7280]"
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
                          <div key={m} className="px-4 py-3 border-t border-b border-[#F1F1F1] bg-white">
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
                              <Button type="button" variant="outline" size="sm" onClick={cancelEdit}>
                                Cancel
                              </Button>
                              <Button type="button" size="sm" onClick={() => handleSheetInlineSave(tab, m)}>
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
                              {isOwnTargetView && (
                                <button
                                  onClick={enterEdit}
                                  className="text-muted-foreground hover:text-[#09090B]"
                                  aria-label={`Edit ${name} target`}
                                >
                                  <Pencil className="h-4 w-4" />
                                </button>
                              )}
                            </div>
                          ) : (
                            <div className="flex items-center gap-3">
                              <span className="text-sm italic text-muted-foreground">Not set</span>
                              {isOwnTargetView && (
                                <button
                                  onClick={enterEdit}
                                  className="text-muted-foreground hover:text-[#09090B]"
                                  aria-label={`Set ${name} target`}
                                >
                                  <Plus className="h-4 w-4" />
                                </button>
                              )}
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

// ─── Stat card ──────────────────────────────────────────────────────────────

function StatCard({
  title,
  value,
  accent,
  isCurrency,
}: {
  title: string;
  value: number | string;
  accent?: string;
  isCurrency?: boolean;
}) {
  return (
    <Card className="shadow-none">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${accent ?? ''}`}>
          {isCurrency && typeof value !== 'number' ? `AED ${value}` : value}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Add / Edit Modal ──────────────────────────────────────────────────────

function EntryModal({
  isOpen,
  onClose,
  onSave,
  entry,
  error,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => void;
  entry: SalesKPIEntry | null;
  error: string;
}) {
  const isEdit = !!entry;

  const [date, setDate] = useState<string>(entry?.date ?? '');
  const [customerName, setCustomerName] = useState(entry?.customer_name ?? '');
  const [entryType, setEntryType] = useState<SalesKPIEntryType>(entry?.entry_type ?? 'new');
  const [classOfInsuranceId, setClassOfInsuranceId] = useState<number | null>(
    typeof entry?.class_of_insurance === 'number' ? entry.class_of_insurance : null,
  );
  const [assigneeId, setAssigneeId] = useState<number | null>(
    typeof entry?.assignee === 'number' ? entry.assignee : null,
  );
  const [potentialPremium, setPotentialPremium] = useState(
    entry?.potential_premium != null ? String(entry.potential_premium) : '',
  );
  const [initialRemark, setInitialRemark] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setDate(entry?.date ?? toLocalDateString(new Date()));
    setCustomerName(entry?.customer_name ?? '');
    setEntryType(entry?.entry_type ?? 'new');
    setClassOfInsuranceId(typeof entry?.class_of_insurance === 'number' ? entry.class_of_insurance : null);
    setAssigneeId(typeof entry?.assignee === 'number' ? entry.assignee : null);
    setPotentialPremium(entry?.potential_premium != null ? String(entry.potential_premium) : '');
    setInitialRemark('');
  }, [isOpen, entry]);

  const assigneeFetchPage = useCallback(
    async ({ search, page }: { search: string; page: number }) => {
      const res = await getUsersForModulePage('sales_kpi', { search, page });
      return {
        results: res.data?.results ?? [],
        hasMore: res.data?.has_more ?? false,
      };
    },
    [],
  );

  const classFetchPage = useCallback(
    async ({ search, page }: { search: string; page: number }) => {
      const res = await getClassOfInsurancePage({ search, page });
      return {
        results: res.data?.results ?? [],
        hasMore: res.data?.has_more ?? false,
      };
    },
    [],
  );

  const canSubmit =
    customerName.trim() !== '' &&
    classOfInsuranceId !== null &&
    assigneeId !== null &&
    !isSubmitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setIsSubmitting(true);
    const payload: Record<string, unknown> = {
      customer_name: customerName.trim(),
      entry_type: entryType,
      class_of_insurance: classOfInsuranceId,
      assignee: assigneeId,
      potential_premium: potentialPremium.trim() === '' ? null : potentialPremium.trim(),
    };
    if (isEdit) {
      payload.date = date;
    } else if (initialRemark.trim()) {
      payload.initial_remark = initialRemark.trim();
    }
    await onSave(payload);
    setIsSubmitting(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="p-0 sm:max-w-md">
        <DialogHeader className="border-b border-[#E4E4E4] p-4">
          <DialogTitle>{isEdit ? 'Edit Enquiry' : 'Add Enquiry'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 p-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-md text-sm">
              {error}
            </div>
          )}

          {isEdit && (
            <FormDatePicker
              label="Date"
              value={date}
              onChange={(d) => setDate(d)}
              required
            />
          )}

          <div className="space-y-2">
            <Label>Customer Name *</Label>
            <Input
              type="text"
              placeholder="Enter customer name"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Type *</Label>
              <Select
                value={entryType}
                onValueChange={(v) => setEntryType(v as SalesKPIEntryType)}
              >
                <SelectTrigger className="w-full shadow-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Potential Premium</Label>
              <Input
                type="number"
                min={0}
                step={0.01}
                placeholder="0.00"
                value={potentialPremium}
                onChange={(e) => setPotentialPremium(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Class of Insurance *</Label>
            <SearchableSelect
              value={classOfInsuranceId ? String(classOfInsuranceId) : null}
              onValueChange={(v) => setClassOfInsuranceId(v ? Number(v) : null)}
              placeholder="Select class"
              emptyLabel="No classes found"
              selectedLabel={entry?.class_of_insurance_name ?? null}
              getOptionValue={(c) => String(c.id)}
              getOptionLabel={(c) => c.name}
              fetchPage={classFetchPage}
            />
          </div>

          <div className="space-y-2">
            <Label>Assignee *</Label>
            <SearchableSelect
              value={assigneeId ? String(assigneeId) : null}
              onValueChange={(v) => setAssigneeId(v ? Number(v) : null)}
              placeholder="Select assignee"
              emptyLabel="No users found"
              selectedLabel={entry?.assignee_name ?? null}
              getOptionValue={(u) => String(u.id)}
              getOptionLabel={(u) => u.full_name || u.email}
              fetchPage={assigneeFetchPage}
            />
          </div>

          {!isEdit && (
            <div className="space-y-2">
              <Label>Remark</Label>
              <Textarea
                placeholder="Optional"
                value={initialRemark}
                onChange={(e) => setInitialRemark(e.target.value)}
                rows={3}
              />
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {isSubmitting ? 'Saving…' : isEdit ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Target Modal (unchanged shape) ────────────────────────────────────────

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
                Cancel
              </Button>
            )}
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : `✓ Save ${MONTH_NAMES[month - 1]} Targets`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
