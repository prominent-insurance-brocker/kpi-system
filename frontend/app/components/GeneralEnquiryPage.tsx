'use client';

/**
 * Standalone page for the General Renewal module.
 *
 * Cloned from MotorEnquiryPage on 2026-05-15. Mirrors Motor Renewal's
 * per-enquiry workflow (client_name, agent FK, remarks, status state
 * machine, revisions, status_changed_at) plus the Client Retention monthly
 * target feature, but WITHOUT the motor-specific chassis_no field — general
 * insurance products don't have a chassis.
 *
 * IMPORTANT: this file was duplicated rather than refactored into a shared
 * base. Future bug fixes in MotorEnquiryPage need to be mirrored here too.
 *
 * Tabs: Dashboard | Tracker View | Enquiries
 *   - Dashboard: 7 stat cards driven by /stats/ (incl. Retained / Total
 *     Assigned Clients ratio card)
 *   - Tracker View: PersonalDailyTracker (everyone) + admin-only team TrackerView
 *   - Enquiries: filter bar + paginated DataTable + inline RemarksPanel
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Plus,
  Minus,
  FileText,
  X,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Calendar,
  Pencil,
  Check,
} from 'lucide-react';
import { toast } from 'sonner';

import { Progress } from '@/components/ui/progress';
import { DataTable } from '@/app/components/DataTable';
import { FilterBar } from '@/app/components/FilterBar';
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
  AddedByCell,
  PersonalDailyTracker,
  TrackerView,
  toLocalDateString,
  MONTH_NAMES,
  type ModuleUser,
} from '@/app/components/KpiModulePage';
import { useAuth } from '@/app/context/AuthContext';
import { useConfirm } from '@/app/components/ConfirmDialog';
import { RemarksPanel } from '@/app/components/RemarksPanel';
import { formatDate } from '@/app/lib/date';
import {
  fetchApi,
  getUsersForModule,
  getUsersForModulePage,
  getGeneralRenewalStats,
  updateGeneralRenewalStatus,
  updateGeneralRenewalRevisions,
  getCurrentGeneralRenewalMonthlyTarget,
  getGeneralRenewalMonthlyTargets,
  createGeneralRenewalMonthlyTarget,
  updateGeneralRenewalMonthlyTarget,
  getRemarksContentTypes,
  REMARKS_MODEL_NAME_BY_API_SLUG,
  type GeneralRenewalMonthlyTarget,
  type GeneralRenewalEntry,
  type GeneralRenewalStats,
} from '@/app/lib/api';

// ─── Module configuration (hardcoded — this file serves general_renewal only) ─
const MODULE_KEY = 'general_renewal';
const API_SLUG = 'general-renewal';
const TITLE = 'General Renewal';
const TOTAL_LABEL = 'Total Enquiries Added';
const SUCCESS_LABEL = 'Retained';

type SuccessStatus = 'retained';

const STATUS_OPTIONS: Array<{ value: GeneralRenewalEntry['status']; label: string }> = [
  { value: 'new', label: 'New Enquiry' },
  { value: 'retained', label: 'Retained' },
  { value: 'lost', label: 'Lost' },
];

const STATUS_COLORS: Record<GeneralRenewalEntry['status'], string> = {
  new: 'bg-blue-100 text-blue-800',
  retained: 'bg-green-100 text-green-800',
  lost: 'bg-red-100 text-red-800',
};

function statusLabelFor(value: GeneralRenewalEntry['status']) {
  const opt = STATUS_OPTIONS.find((o) => o.value === value);
  return opt?.label ?? value;
}

function StatusBadge({
  status,
  label,
}: {
  status: GeneralRenewalEntry['status'];
  label: string;
}) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[status] || ''}`}
    >
      {label}
    </span>
  );
}

function formatTatFromMinutes(minutes: number | null | undefined): string {
  if (minutes == null) return '—';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  const days = hours / 24;
  return `${days.toFixed(1)}d`;
}

function formatAccuracy(pct: number | null | undefined): string {
  if (pct == null) return '—';
  return `${pct.toFixed(1)}%`;
}

export function GeneralEnquiryPage() {
  const { canSeeAllData, user } = useAuth();
  const confirm = useConfirm();
  const isAdmin = canSeeAllData();
  const currentUserId = user?.id;
  const userFullName = user?.full_name ?? '';

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  // ── Top-level state ────────────────────────────────────────────────────────
  const [activeView, setActiveView] = useState<'dashboard' | 'tracker' | 'enquiries'>('enquiries');

  // Filters (Enquiries tab)
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [userId, setUserId] = useState('');
  const [agentId, setAgentId] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [clientName, setClientName] = useState('');

  // Dashboard filters
  const [dashFrom, setDashFrom] = useState('');
  const [dashTo, setDashTo] = useState('');
  const [dashUserId, setDashUserId] = useState('');

  // Data
  const [entries, setEntries] = useState<GeneralRenewalEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [stats, setStats] = useState<GeneralRenewalStats>({
    total: 0,
    revised: 0,
    converted: 0,
    retained: 0,
    lost: 0,
    avg_tat_minutes: null,
    avg_accuracy: null,
  });

  // Tracker — month state + entries
  const [personalCalYear, setPersonalCalYear] = useState(today.getFullYear());
  const [personalCalMonth, setPersonalCalMonth] = useState(today.getMonth());
  const [teamCalYear, setTeamCalYear] = useState(today.getFullYear());
  const [teamCalMonth, setTeamCalMonth] = useState(today.getMonth());
  const [trackerUserFilter, setTrackerUserFilter] = useState<string>('all');
  const [monthEntries, setMonthEntries] = useState<GeneralRenewalEntry[]>([]);

  // Module + sales-KPI user pools
  const [moduleUsers, setModuleUsers] = useState<ModuleUser[]>([]);
  const [salesUsers, setSalesUsers] = useState<ModuleUser[]>([]);

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<GeneralRenewalEntry | null>(null);
  const [modalError, setModalError] = useState('');

  // Status-change verification modal
  const [pendingStatus, setPendingStatus] = useState<{
    entry: GeneralRenewalEntry;
    newStatus: SuccessStatus | 'lost';
  } | null>(null);

  // Remarks side panel
  const [panelEntry, setPanelEntry] = useState<GeneralRenewalEntry | null>(null);
  const [ctMap, setCtMap] = useState<Record<string, number>>({});
  useEffect(() => {
    getRemarksContentTypes().then((res) => {
      if (res.data) setCtMap(res.data);
    });
  }, []);
  const remarksContentTypeId = ctMap[REMARKS_MODEL_NAME_BY_API_SLUG[API_SLUG]] ?? null;

  // ── Monthly target state (Client Retention) ─────────────────────────────────
  const [targetCardYear, setTargetCardYear] = useState(today.getFullYear());
  const [targetCardMonth, setTargetCardMonth] = useState(today.getMonth() + 1);
  const [targetCard, setTargetCard] = useState<GeneralRenewalMonthlyTarget | null>(null);
  const [targetActuals, setTargetActuals] = useState(0);
  const [isTargetModalOpen, setIsTargetModalOpen] = useState(false);
  const [currentTargetLoaded, setCurrentTargetLoaded] = useState(false);
  const [currentTarget, setCurrentTarget] = useState<GeneralRenewalMonthlyTarget | null>(null);

  // Right-side "Monthly Targets" panel
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [sheetYear, setSheetYear] = useState(today.getFullYear());
  const [sheetTargets, setSheetTargets] = useState<GeneralRenewalMonthlyTarget[]>([]);
  const [sheetEditingMonth, setSheetEditingMonth] = useState<number | null>(null);
  const [sheetInlineValues, setSheetInlineValues] = useState<Record<number, string>>({});

  // ── Fetchers ────────────────────────────────────────────────────────────────
  const fetchEntries = useCallback(async () => {
    setIsLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set('page', String(page));
      qs.set('page_size', String(pageSize));
      if (dateFrom) qs.set('date_from', dateFrom);
      if (dateTo) qs.set('date_to', dateTo);
      if (userId) qs.set('user_id', userId);
      if (agentId) qs.set('agent_id', agentId);
      if (statusFilter) qs.set('status', statusFilter);
      if (clientName) qs.set('client_name', clientName);

      const result = await fetchApi<{ results: GeneralRenewalEntry[]; count: number }>(
        `/api/entries/${API_SLUG}/?${qs}`
      );
      setEntries(result.data?.results || []);
      setTotalCount(result.data?.count || 0);
    } finally {
      setIsLoading(false);
    }
  }, [page, pageSize, dateFrom, dateTo, userId, agentId, statusFilter, clientName]);

  const fetchStats = useCallback(async () => {
    const result = await getGeneralRenewalStats({
      date_from: dashFrom || undefined,
      date_to: dashTo || undefined,
      user_id: dashUserId || undefined,
    });
    if (result.data) {
      setStats(result.data);
    } else {
      console.error('Failed to load general renewal stats:', result.error);
      toast.error(result.error || 'Failed to load dashboard stats');
    }
  }, [dashFrom, dashTo, dashUserId]);

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
          return fetchApi<{ results: GeneralRenewalEntry[] }>(
            `/api/entries/${API_SLUG}/?${qs}`
          );
        })
      );
      const merged = new Map<number, GeneralRenewalEntry>();
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

  // ── Monthly-target fetchers ─────────────────────────────────────────────────
  const fetchCurrentTarget = useCallback(async () => {
    const result = await getCurrentGeneralRenewalMonthlyTarget();
    setCurrentTarget(result.data ?? null);
    setCurrentTargetLoaded(true);
  }, []);

  const fetchSheetTargets = useCallback(async () => {
    const result = await getGeneralRenewalMonthlyTargets({ year: sheetYear });
    setSheetTargets(result.data ?? []);
  }, [sheetYear]);

  const fetchTargetCard = useCallback(async () => {
    const [targetResult, statsResult] = await Promise.all([
      getGeneralRenewalMonthlyTargets({
        year: targetCardYear,
        month: targetCardMonth,
      }),
      (async () => {
        const firstDay = `${targetCardYear}-${String(targetCardMonth).padStart(2, '0')}-01`;
        const lastDay = toLocalDateString(new Date(targetCardYear, targetCardMonth, 0));
        const qs = new URLSearchParams({
          date_from: firstDay,
          date_to: lastDay,
          status: 'retained',
        });
        if (currentUserId != null) qs.set('user_id', String(currentUserId));
        return fetchApi<{ count: number }>(`/api/entries/${API_SLUG}/?${qs}`);
      })(),
    ]);
    setTargetCard(targetResult.data?.[0] ?? null);
    setTargetActuals(statsResult.data?.count ?? 0);
  }, [targetCardYear, targetCardMonth, currentUserId]);

  const handleSheetInlineSave = async (month: number) => {
    const raw = sheetInlineValues[month];
    if (raw === '' || raw === undefined) {
      setSheetEditingMonth(null);
      return;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      toast.error('Assigned clients must be greater than 0.');
      return;
    }
    const existing = sheetTargets.find((t) => t.month === month);
    const result = existing?.id
      ? await updateGeneralRenewalMonthlyTarget(existing.id, { clients_assigned: value })
      : await createGeneralRenewalMonthlyTarget({
          year: sheetYear,
          month,
          clients_assigned: value,
        });
    if (result.data) {
      setSheetEditingMonth(null);
      setSheetInlineValues((prev) => {
        const next = { ...prev };
        delete next[month];
        return next;
      });
      fetchSheetTargets();
      if (sheetYear === targetCardYear && month === targetCardMonth) {
        fetchTargetCard();
      }
      if (sheetYear === today.getFullYear() && month === today.getMonth() + 1) {
        fetchCurrentTarget();
      }
    } else {
      toast.error(result.error || 'Failed to save target.');
    }
  };

  // ── Initial loads ────────────────────────────────────────────────────────
  useEffect(() => {
    getUsersForModule(MODULE_KEY).then((r) => {
      if (r.data) setModuleUsers(r.data);
    });
    getUsersForModule('sales_kpi').then((r) => {
      if (r.data) setSalesUsers(r.data);
    });
  }, []);

  useEffect(() => {
    if (activeView === 'enquiries') fetchEntries();
  }, [activeView, fetchEntries]);

  useEffect(() => {
    if (activeView === 'dashboard') fetchStats();
  }, [activeView, fetchStats]);

  useEffect(() => {
    if (activeView === 'tracker') fetchMonthEntries();
  }, [activeView, fetchMonthEntries]);

  useEffect(() => {
    fetchCurrentTarget();
  }, [fetchCurrentTarget]);

  useEffect(() => {
    fetchTargetCard();
  }, [fetchTargetCard]);

  // No current-month target → block mutations + auto-open the modal.
  const noCurrentTarget = currentTargetLoaded && !currentTarget;
  const isCurrentMonthCard =
    targetCardYear === today.getFullYear() &&
    targetCardMonth === today.getMonth() + 1;

  useEffect(() => {
    if (noCurrentTarget) {
      setIsTargetModalOpen(true);
    }
  }, [noCurrentTarget]);

  useEffect(() => {
    if (isPanelOpen) fetchSheetTargets();
  }, [isPanelOpen, sheetYear, fetchSheetTargets]);

  // ── Mutations ────────────────────────────────────────────────────────────
  const refreshAfterMutation = () => {
    fetchEntries();
    fetchStats();
    fetchMonthEntries();
    fetchTargetCard();
  };

  const handleSaveNew = async (payload: {
    client_name: string;
    agent: number;
    remarks: string;
    quotes_compared: number;
  }) => {
    setModalError('');
    const isEdit = !!editingEntry;
    const url = isEdit
      ? `/api/entries/${API_SLUG}/${editingEntry!.id}/`
      : `/api/entries/${API_SLUG}/`;
    // Remarks textarea is hidden on edit; on create, the typed text becomes
    // the entry's first EntryRemark via the write-only `initial_remark` field.
    const { remarks, ...rest } = payload;
    const body = isEdit
      ? rest
      : { date: toLocalDateString(today), ...rest, initial_remark: remarks };
    const result = await fetchApi<GeneralRenewalEntry>(url, {
      method: isEdit ? 'PATCH' : 'POST',
      body: JSON.stringify(body),
    });
    if (result.data) {
      setIsModalOpen(false);
      setEditingEntry(null);
      toast.success(isEdit ? 'Enquiry updated' : 'Enquiry added');
      refreshAfterMutation();
    } else {
      setModalError(result.error || 'Failed to save enquiry');
    }
  };

  const handleDelete = async (entry: GeneralRenewalEntry) => {
    const ok = await confirm({
      title: 'Delete enquiry?',
      description: 'This action cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    const result = await fetchApi<void>(`/api/entries/${API_SLUG}/${entry.id}/`, {
      method: 'DELETE',
    });
    if (!result.error) {
      toast.success('Enquiry deleted');
      if (panelEntry?.id === entry.id) setPanelEntry(null);
      refreshAfterMutation();
    } else {
      toast.error(result.error || 'Failed to delete enquiry');
    }
  };

  const updateRevisions = async (entry: GeneralRenewalEntry, newCount: number) => {
    if (newCount < 0) return;
    setEntries((curr) =>
      curr.map((e) => (e.id === entry.id ? { ...e, revisions: newCount } : e))
    );
    const result = await updateGeneralRenewalRevisions(entry.id, newCount);
    if (!result.data) {
      setEntries((curr) =>
        curr.map((e) => (e.id === entry.id ? { ...e, revisions: entry.revisions } : e))
      );
      toast.error(result.error || 'Failed to update revisions');
    }
  };

  const applyStatusChange = async (
    entry: GeneralRenewalEntry,
    newStatus: SuccessStatus | 'lost',
    revisions?: number
  ) => {
    const result = await updateGeneralRenewalStatus(entry.id, {
      status: newStatus,
      ...(revisions != null ? { revisions } : {}),
    });
    if (result.data) {
      toast.success(`Marked as ${statusLabelFor(newStatus)}`);
      setPendingStatus(null);
      refreshAfterMutation();
    } else {
      toast.error(result.error || 'Failed to update status');
    }
  };

  // ── Columns ──────────────────────────────────────────────────────────────
  const columns = [
    {
      key: 'pib_id',
      header: 'ID',
      render: (item: GeneralRenewalEntry) => item.pib_id,
    },
    { key: 'client_name', header: 'Client Name' },
    {
      key: 'status',
      header: 'Status',
      render: (item: GeneralRenewalEntry) =>
        item.is_terminal || item.allowed_transitions.length === 0 ? (
          <StatusBadge status={item.status} label={statusLabelFor(item.status)} />
        ) : (
          <Select
            value={item.status}
            onValueChange={(v) => {
              if (v === 'retained' || v === 'lost') {
                setPendingStatus({
                  entry: item,
                  newStatus: v as SuccessStatus | 'lost',
                });
              }
            }}
          >
            <SelectTrigger className="h-8 w-[140px] text-xs shadow-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={item.status} disabled>
                {statusLabelFor(item.status)}
              </SelectItem>
              {item.allowed_transitions.map((s) => (
                <SelectItem key={s} value={s}>
                  {statusLabelFor(s as GeneralRenewalEntry['status'])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ),
    },
    {
      key: 'added_by_name',
      header: 'Added by',
      render: (item: GeneralRenewalEntry) => <AddedByCell entry={item} />,
    },
    { key: 'agent_name', header: 'Agent Name' },
    {
      key: 'revisions',
      header: 'Revisions',
      render: (item: GeneralRenewalEntry) => {
        if (item.status !== 'new') {
          return <span className="text-sm text-[#374151]">{item.revisions}</span>;
        }
        return (
          <div className="inline-flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => updateRevisions(item, item.revisions - 1)}
              disabled={item.revisions === 0}
              className="h-6 w-6 inline-flex items-center justify-center rounded-md border border-[#E4E4E4] text-[#71717A] hover:bg-[#F3F3F3] disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Decrement revisions"
            >
              <Minus className="h-3 w-3" />
            </button>
            <span className="text-sm font-medium text-[#374151] w-5 text-center">
              {item.revisions}
            </span>
            <button
              type="button"
              onClick={() => updateRevisions(item, item.revisions + 1)}
              className="h-6 w-6 inline-flex items-center justify-center rounded-md border border-[#E4E4E4] text-[#71717A] hover:bg-[#F3F3F3]"
              aria-label="Increment revisions"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
        );
      },
    },
    {
      key: 'tat_display',
      header: 'TAT',
      render: (item: GeneralRenewalEntry) => item.tat_display || '—',
    },
    {
      key: 'accuracy_pct',
      header: 'Accuracy',
      render: (item: GeneralRenewalEntry) => formatAccuracy(item.accuracy_pct),
    },
    {
      key: 'quotes_compared',
      header: 'No. of Quotes Compared',
      render: (item: GeneralRenewalEntry) => item.quotes_compared,
    },
    {
      key: 'added_at',
      header: 'Added on',
      render: (item: GeneralRenewalEntry) => formatDate(item.added_at.split('T')[0]),
    },
    {
      key: 'notes',
      header: 'Notes',
      render: (item: GeneralRenewalEntry) => (
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

  const hasActiveFilters =
    !!(dateFrom || dateTo || userId || agentId || statusFilter || clientName);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="p-6 flex gap-6 items-start">
      <div className="flex-1 min-w-0 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">{TITLE}</h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setIsPanelOpen((o) => !o)}>
              <Pencil className="h-4 w-4 mr-2" />
              Monthly Targets
            </Button>
          </div>
        </div>

        {/* Client Retention target card — sits between the page header and tabs. */}
        <ClientRetentionTargetCard
          year={targetCardYear}
          month={targetCardMonth}
          target={targetCard}
          actuals={targetActuals}
          onPrev={() => {
            if (targetCardMonth === 1) {
              setTargetCardMonth(12);
              setTargetCardYear((y) => y - 1);
            } else {
              setTargetCardMonth((m) => m - 1);
            }
          }}
          onNext={() => {
            if (targetCardMonth === 12) {
              setTargetCardMonth(1);
              setTargetCardYear((y) => y + 1);
            } else {
              setTargetCardMonth((m) => m + 1);
            }
          }}
          onToday={() => {
            setTargetCardYear(today.getFullYear());
            setTargetCardMonth(today.getMonth() + 1);
          }}
          onEdit={() => setIsTargetModalOpen(true)}
        />

        <Tabs value={activeView} onValueChange={(v) => setActiveView(v as typeof activeView)}>
          <TabsList className="bg-[#F3F4F6] rounded-lg p-1 gap-0 w-fit">
            <TabsTrigger value="dashboard" className="rounded-md px-4 py-1.5 data-[state=active]:bg-white">
              Dashboard
            </TabsTrigger>
            <TabsTrigger value="tracker" className="rounded-md px-4 py-1.5 data-[state=active]:bg-white">
              Tracker View
            </TabsTrigger>
            <TabsTrigger value="enquiries" className="rounded-md px-4 py-1.5 data-[state=active]:bg-white">
              Enquiries
            </TabsTrigger>
          </TabsList>

          {/* ─── Dashboard ────────────────────────────────────────────────── */}
          <TabsContent value="dashboard" className="mt-4 space-y-4">
            <FilterBar
              dateRange={{
                from: dashFrom,
                to: dashTo,
                onChange: (from, to) => {
                  setDashFrom(from);
                  setDashTo(to);
                },
              }}
              user={
                isAdmin
                  ? {
                      value: dashUserId,
                      onChange: (v) => setDashUserId(v),
                      moduleKey: MODULE_KEY,
                      selectedLabel:
                        moduleUsers.find((u) => String(u.id) === dashUserId)?.full_name ?? null,
                    }
                  : undefined
              }
              hasActiveFilters={!!(dashFrom || dashTo || dashUserId)}
              onClear={() => {
                setDashFrom('');
                setDashTo('');
                setDashUserId('');
              }}
            />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6 xl:grid-cols-7">
              <RatioCard
                label={`${SUCCESS_LABEL} / Total Assigned Clients`}
                total={stats.total}
                success={stats.retained}
              />
              <StatCard label={TOTAL_LABEL} value={stats.total} accent="text-[#09090B]" />
              <StatCard label="Enquiries Revised" value={stats.revised} accent="text-[#A855F7]" />
              <StatCard
                label={SUCCESS_LABEL}
                value={stats.retained}
                accent="text-green-700"
              />
              <StatCard label="Lost" value={stats.lost} accent="text-red-700" />
              <StatCard
                label="Avg. TAT"
                value={formatTatFromMinutes(stats.avg_tat_minutes)}
                accent="text-[#0EA5E9]"
              />
              <StatCard
                label="Avg. Accuracy"
                value={formatAccuracy(stats.avg_accuracy)}
                accent="text-[#F97316]"
              />
            </div>
          </TabsContent>

          {/* ─── Tracker View ─────────────────────────────────────────────── */}
          <TabsContent value="tracker" className="mt-4 space-y-4">
            <PersonalDailyTracker<GeneralRenewalEntry>
              calYear={personalCalYear}
              calMonth={personalCalMonth}
              today={today}
              monthEntries={monthEntries}
              currentUserId={currentUserId}
              userFullName={userFullName}
              onPrevMonth={() => {
                if (personalCalMonth === 0) {
                  setPersonalCalMonth(11);
                  setPersonalCalYear(personalCalYear - 1);
                } else {
                  setPersonalCalMonth(personalCalMonth - 1);
                }
              }}
              onNextMonth={() => {
                if (personalCalMonth === 11) {
                  setPersonalCalMonth(0);
                  setPersonalCalYear(personalCalYear + 1);
                } else {
                  setPersonalCalMonth(personalCalMonth + 1);
                }
              }}
              onGoToday={() => {
                setPersonalCalYear(today.getFullYear());
                setPersonalCalMonth(today.getMonth());
              }}
            />
            {isAdmin && (
              <TrackerView<GeneralRenewalEntry>
                calYear={teamCalYear}
                calMonth={teamCalMonth}
                monthEntries={monthEntries}
                moduleUsers={moduleUsers}
                trackerUserFilter={trackerUserFilter}
                onTrackerUserFilterChange={setTrackerUserFilter}
                onPrevMonth={() => {
                  if (teamCalMonth === 0) {
                    setTeamCalMonth(11);
                    setTeamCalYear(teamCalYear - 1);
                  } else {
                    setTeamCalMonth(teamCalMonth - 1);
                  }
                }}
                onNextMonth={() => {
                  if (teamCalMonth === 11) {
                    setTeamCalMonth(0);
                    setTeamCalYear(teamCalYear + 1);
                  } else {
                    setTeamCalMonth(teamCalMonth + 1);
                  }
                }}
                onGoToday={() => {
                  setTeamCalYear(today.getFullYear());
                  setTeamCalMonth(today.getMonth());
                }}
              />
            )}
          </TabsContent>

          {/* ─── Enquiries ────────────────────────────────────────────────── */}
          <TabsContent value="enquiries" className="mt-4 space-y-4">
            <div className="flex items-end justify-between gap-4 flex-wrap">
              <FilterBar
                search={{
                  value: clientName,
                  onChange: (v) => {
                    setClientName(v);
                    setPage(1);
                  },
                  placeholder: 'Search by client name…',
                  label: 'Client',
                }}
                dateRange={{
                  from: dateFrom,
                  to: dateTo,
                  onChange: (from, to) => {
                    setDateFrom(from);
                    setDateTo(to);
                    setPage(1);
                  },
                }}
                user={
                  isAdmin
                    ? {
                        value: userId,
                        onChange: (v) => {
                          setUserId(v);
                          setPage(1);
                        },
                        moduleKey: MODULE_KEY,
                        selectedLabel:
                          moduleUsers.find((u) => String(u.id) === userId)?.full_name ?? null,
                      }
                    : undefined
                }
                agent={{
                  value: agentId,
                  onChange: (v) => {
                    setAgentId(v);
                    setPage(1);
                  },
                  moduleKey: 'sales_kpi',
                  selectedLabel:
                    salesUsers.find((u) => String(u.id) === agentId)?.full_name ?? null,
                }}
                status={{
                  value: statusFilter,
                  onChange: (v) => {
                    setStatusFilter(v);
                    setPage(1);
                  },
                  options: STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
                }}
                hasActiveFilters={hasActiveFilters}
                onClear={() => {
                  setDateFrom('');
                  setDateTo('');
                  setUserId('');
                  setAgentId('');
                  setStatusFilter('');
                  setClientName('');
                  setPage(1);
                }}
              />
              <Button
                disabled={noCurrentTarget}
                title={noCurrentTarget ? "Set this month's retention target first" : undefined}
                onClick={() => {
                  if (noCurrentTarget) {
                    setIsTargetModalOpen(true);
                    return;
                  }
                  setEditingEntry(null);
                  setModalError('');
                  setIsModalOpen(true);
                }}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Enquiry
              </Button>
            </div>

            <div className="flex gap-4">
              <div className="flex-1 min-w-0">
                <DataTable
                  columns={columns}
                  data={entries}
                  totalCount={totalCount}
                  page={page}
                  pageSize={pageSize}
                  onPageChange={setPage}
                  onPageSizeChange={(s) => {
                    setPageSize(s);
                    setPage(1);
                  }}
                  onEdit={(entry) => {
                    setEditingEntry(entry);
                    setModalError('');
                    setIsModalOpen(true);
                  }}
                  onDelete={handleDelete}
                  canEdit={(entry) => entry.status === 'new' && entry.is_editable}
                  canDelete={(entry) =>
                    entry.added_by === currentUserId && entry.status === 'new'
                  }
                  isLoading={isLoading}
                />
              </div>
              <RemarksPanel
                contentTypeId={remarksContentTypeId}
                objectId={panelEntry?.id ?? null}
                entryLabel={panelEntry ? `${TITLE} — ${panelEntry.pib_id}` : ''}
                open={!!panelEntry}
                onOpenChange={(open) => {
                  if (!open) setPanelEntry(null);
                }}
              />
            </div>
          </TabsContent>
        </Tabs>

        {/* ── Add / Edit Enquiry modal ───────────────────────────────────────── */}
        <Dialog
          open={isModalOpen}
          onOpenChange={(open) => {
            if (!open) {
              setIsModalOpen(false);
              setEditingEntry(null);
              setModalError('');
            }
          }}
        >
          <DialogContent className="p-0">
            <DialogHeader className="border-b border-[#E4E4E4] p-4">
              <DialogTitle>{editingEntry ? 'Edit Enquiry' : 'New Enquiry'}</DialogTitle>
            </DialogHeader>
            <EnquiryForm
              entry={editingEntry}
              error={modalError}
              onSave={handleSaveNew}
              onClose={() => {
                setIsModalOpen(false);
                setEditingEntry(null);
              }}
            />
          </DialogContent>
        </Dialog>

        {/* ── Status transition verification modal ───────────────────────────── */}
        {pendingStatus && (
          <StatusTransitionModal
            entry={pendingStatus.entry}
            newStatus={pendingStatus.newStatus}
            newStatusLabel={statusLabelFor(pendingStatus.newStatus)}
            onCancel={() => setPendingStatus(null)}
            onConfirm={(revisions) =>
              applyStatusChange(pendingStatus.entry, pendingStatus.newStatus, revisions)
            }
          />
        )}

        {/* ── Client Retention edit-target modal ──────────────────────────────── */}
        <GeneralRenewalTargetModal
          isOpen={isTargetModalOpen}
          year={noCurrentTarget ? today.getFullYear() : targetCardYear}
          month={noCurrentTarget ? today.getMonth() + 1 : targetCardMonth}
          existing={
            noCurrentTarget
              ? currentTarget
              : isCurrentMonthCard
              ? currentTarget ?? targetCard
              : targetCard
          }
          required={noCurrentTarget}
          onClose={() => setIsTargetModalOpen(false)}
          onSaved={() => {
            setIsTargetModalOpen(false);
            fetchCurrentTarget();
            fetchTargetCard();
            fetchSheetTargets();
          }}
        />
      </div>

      {/* ── Right-side Monthly Targets panel ──────────────────────────────────── */}
      {isPanelOpen && (
        <div className="w-[340px] shrink-0 border rounded-lg overflow-hidden bg-white">
          <div className="flex items-start justify-between px-4 py-3 border-b">
            <div>
              <h3 className="font-semibold text-base text-[#09090B]">Monthly Targets</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Calendar year client retention targets
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
          <div>
            {MONTH_NAMES.map((name, idx) => {
              const m = idx + 1;
              const t = sheetTargets.find((row) => row.month === m);
              const val = t?.clients_assigned;
              const isSet = val !== null && val !== undefined;
              const isEditing = sheetEditingMonth === m;

              const enterEdit = () => {
                setSheetEditingMonth(m);
                setSheetInlineValues((prev) => ({
                  ...prev,
                  [m]: isSet ? String(val) : '',
                }));
              };
              const cancelEdit = () => {
                setSheetEditingMonth(null);
                setSheetInlineValues((prev) => {
                  const next = { ...prev };
                  delete next[m];
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
                    <Label htmlFor={`gr-target-${m}`} className="text-sm">
                      Client Retention
                    </Label>
                    <Input
                      id={`gr-target-${m}`}
                      type="number"
                      min={1}
                      step={1}
                      autoFocus
                      placeholder="Enter client retention target…"
                      value={sheetInlineValues[m] ?? ''}
                      onChange={(e) =>
                        setSheetInlineValues((prev) => ({
                          ...prev,
                          [m]: e.target.value,
                        }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleSheetInlineSave(m);
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
                      <Button type="button" size="sm" onClick={() => handleSheetInlineSave(m)}>
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
                      <span className="text-sm font-semibold text-[#09090B]">{val}</span>
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
                      <span className="text-sm italic text-muted-foreground">Not set</span>
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
        </div>
      )}
    </div>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function RatioCard({
  label,
  total,
  success,
}: {
  label: string;
  total: number;
  success: number;
}) {
  const pct = total > 0 ? (success / total) * 100 : 0;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold text-[#09090B]">
          {success} / {total}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">({pct.toFixed(1)}%)</div>
      </CardContent>
    </Card>
  );
}

function StatCard({
  label,
  value,
  accent = 'text-[#09090B]',
}: {
  label: string;
  value: number | string;
  accent?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${accent}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

// ─── Enquiry create/edit form ────────────────────────────────────────────────

function EnquiryForm({
  entry,
  onSave,
  onClose,
  error,
}: {
  entry: GeneralRenewalEntry | null;
  onSave: (payload: {
    client_name: string;
    agent: number;
    remarks: string;
    quotes_compared: number;
  }) => void;
  onClose: () => void;
  error: string;
}) {
  const [clientName, setClientName] = useState(entry?.client_name ?? '');
  const [agentId, setAgentId] = useState<number | null>(entry?.agent ?? null);
  const [remarks, setRemarks] = useState('');
  const [quotesCompared, setQuotesCompared] = useState<string>(
    entry?.quotes_compared != null ? String(entry.quotes_compared) : '0'
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const agentFetchPage = useCallback(
    async ({ search, page }: { search: string; page: number }) => {
      const res = await getUsersForModulePage('sales_kpi', { search, page });
      return {
        results: res.data?.results ?? [],
        hasMore: res.data?.has_more ?? false,
      };
    },
    []
  );

  useEffect(() => {
    setClientName(entry?.client_name ?? '');
    setAgentId(entry?.agent ?? null);
    setRemarks('');
    setQuotesCompared(entry?.quotes_compared != null ? String(entry.quotes_compared) : '0');
  }, [entry]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!agentId) return;
    setIsSubmitting(true);
    onSave({
      client_name: clientName,
      agent: agentId,
      remarks,
      quotes_compared: Math.max(0, Number(quotesCompared || 0)),
    });
    setIsSubmitting(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-md text-sm">
          {error}
        </div>
      )}

      <div className="space-y-2">
        <Label>Client Name *</Label>
        <Input
          type="text"
          placeholder="Enter client name"
          value={clientName}
          onChange={(e) => setClientName(e.target.value)}
          required
        />
      </div>

      <div className="space-y-2">
        <Label>Source / Agent *</Label>
        <SearchableSelect
          value={agentId ? String(agentId) : null}
          onValueChange={(v) => setAgentId(Number(v))}
          placeholder="Select agent"
          emptyLabel="No agents found"
          selectedLabel={entry?.agent_name ?? null}
          getOptionValue={(u) => String(u.id)}
          getOptionLabel={(u) => u.full_name || u.email}
          fetchPage={agentFetchPage}
        />
      </div>

      <div className="space-y-2">
        <Label>No. of Quotes Compared</Label>
        <Input
          type="number"
          min={0}
          step={1}
          placeholder="0"
          value={quotesCompared}
          onChange={(e) => setQuotesCompared(e.target.value)}
        />
      </div>

      {/* Remarks textarea only on Add — on Edit, comments are managed via the
          panel (the note icon on the row). The text typed here becomes the
          new enquiry's first comment via `initial_remark`. */}
      {!entry && (
        <div className="space-y-2">
          <Label>Remarks</Label>
          <Textarea
            placeholder="Add notes or remarks…"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows={3}
          />
        </div>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting || !clientName || !agentId}>
          {isSubmitting ? 'Saving…' : entry ? 'Update' : 'Add Enquiry'}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ─── Status transition verification modal ────────────────────────────────────

function StatusTransitionModal({
  entry,
  newStatus,
  newStatusLabel,
  onCancel,
  onConfirm,
}: {
  entry: GeneralRenewalEntry;
  newStatus: SuccessStatus | 'lost';
  newStatusLabel: string;
  onCancel: () => void;
  onConfirm: (revisions?: number) => void;
}) {
  void newStatus;
  const initialStage: 'ask' | 'verify' = entry.revisions > 0 ? 'verify' : 'ask';
  const [stage, setStage] = useState<'ask' | 'enter' | 'verify'>(initialStage);
  const [enteredCount, setEnteredCount] = useState(0);
  const statusLabel = newStatusLabel;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="p-0">
        <DialogHeader className="border-b border-[#E4E4E4] p-4">
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-[#F59E0B]" />
            Confirm Before Closing
          </DialogTitle>
        </DialogHeader>

        {stage === 'ask' && (
          <div className="p-5 space-y-4">
            <p className="text-sm text-[#374151]">
              Before closing as <strong>{statusLabel}</strong> — did you make any revisions
              for this enquiry?
            </p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onConfirm(0)}>
                No, proceed
              </Button>
              <Button type="button" onClick={() => setStage('enter')}>
                Yes, enter count
              </Button>
            </DialogFooter>
          </div>
        )}

        {stage === 'enter' && (
          <div className="p-5 space-y-4">
            <p className="text-sm text-[#374151]">
              How many revisions were made for this enquiry?
            </p>
            <Input
              type="number"
              min={0}
              value={enteredCount}
              onChange={(e) => setEnteredCount(Math.max(0, Number(e.target.value || 0)))}
              autoFocus
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setStage('ask')}>
                Back
              </Button>
              <Button type="button" onClick={() => onConfirm(enteredCount)}>
                Confirm &amp; Save
              </Button>
            </DialogFooter>
          </div>
        )}

        {stage === 'verify' && (
          <div className="p-5 space-y-4">
            <p className="text-sm text-[#374151]">
              You are marking this enquiry as <strong>{statusLabel}</strong>.
            </p>
            <div className="border border-[#E4E4E4] rounded-lg p-4 flex items-center justify-between">
              <span className="text-sm text-[#71717A]">Revision count recorded</span>
              <span className="text-2xl font-bold text-[#09090B]">{entry.revisions}</span>
            </div>
            <p className="text-xs text-[#71717A]">
              Please verify this count is correct before saving.
            </p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onCancel}>
                Cancel
              </Button>
              <Button type="button" onClick={() => onConfirm(entry.revisions)}>
                Confirm &amp; Save
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Client Retention monthly target card ────────────────────────────────────

const TARGET_MULTIPLIER = 1.5;

function ClientRetentionTargetCard({
  year,
  month,
  target,
  actuals,
  onPrev,
  onNext,
  onToday,
  onEdit,
}: {
  year: number;
  month: number;             // 1-indexed
  target: GeneralRenewalMonthlyTarget | null;
  actuals: number;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onEdit: () => void;
}) {
  const clientsTarget = target?.clients_assigned ?? null;
  const clientsMax = clientsTarget ? clientsTarget * TARGET_MULTIPLIER : 0;
  const clientsPct = clientsMax ? Math.min(100, (actuals / clientsMax) * 100) : 0;
  const clientsMarkerPct = clientsMax ? (clientsTarget! / clientsMax) * 100 : 0;

  return (
    <div className="border rounded-lg p-4 space-y-2 bg-white w-[362px] shrink-0 flex flex-col">
      <h2 className="text-base font-semibold">Monthly Target</h2>
      <div className="space-y-1">
        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-xl font-bold">{actuals.toLocaleString()}</span>
            <span className="text-sm text-muted-foreground">Client Retention</span>
          </div>
          <div className="relative">
            <div
              className={
                clientsTarget !== null && actuals >= clientsTarget
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
      <h3 className="text-xl font-semibold">{MONTH_NAMES[month - 1]} {year}</h3>
      <div className="flex items-center gap-2 mt-auto">
        <div className="flex items-center gap-1">
          <button
            onClick={onPrev}
            className="p-1 border border-[#E4E4E4] rounded hover:bg-accent"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={onNext}
            className="p-1 border border-[#E4E4E4] rounded hover:bg-accent"
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <Button variant="outline" size="sm" onClick={onToday}>
          <Calendar className="h-3 w-3 mr-1" />
          Today
        </Button>
        <Button variant="outline" size="sm" className="ml-auto" onClick={onEdit}>
          <Pencil className="h-3 w-3 mr-1" />
          Edit
        </Button>
      </div>
    </div>
  );
}

function GeneralRenewalTargetModal({
  isOpen,
  year,
  month,
  existing,
  required,
  onClose,
  onSaved,
}: {
  isOpen: boolean;
  year: number;
  month: number;
  existing: GeneralRenewalMonthlyTarget | null;
  required?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [clientsAssigned, setClientsAssigned] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`;
  const isNew = !existing?.id;

  useEffect(() => {
    setClientsAssigned(
      existing?.clients_assigned != null ? String(existing.clients_assigned) : ''
    );
    setError('');
  }, [existing, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = Number(clientsAssigned);
    if (!Number.isFinite(value) || value <= 0) {
      setError('Assigned clients must be greater than 0.');
      return;
    }
    setIsSubmitting(true);
    const result = existing?.id
      ? await updateGeneralRenewalMonthlyTarget(existing.id, { clients_assigned: value })
      : await createGeneralRenewalMonthlyTarget({ year, month, clients_assigned: value });
    setIsSubmitting(false);
    if (result.data) {
      onSaved();
    } else {
      setError(result.error || 'Failed to save target.');
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (required) return;
        if (!open) onClose();
      }}
    >
      <DialogContent
        className={`p-0 sm:max-w-sm${required ? ' [&>button]:hidden' : ''}`}
        onInteractOutside={required ? (e) => e.preventDefault() : undefined}
        onEscapeKeyDown={required ? (e) => e.preventDefault() : undefined}
      >
        <DialogHeader className="border-b border-[#E4E4E4] p-4">
          <DialogTitle>
            {isNew ? `Set ${monthLabel} Target` : `Edit ${monthLabel} Target`}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Enter your retention target for {monthLabel}.
          </p>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-md text-sm">
              {error}
            </div>
          )}
          {required && (
            <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
              <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <p className="text-sm text-amber-800">
                <span className="font-semibold">Action required for {monthLabel}</span> — Set
                your retention target to continue using the module.
              </p>
            </div>
          )}
          <div className="space-y-2">
            <Label>Client Retention Target</Label>
            <Input
              type="number"
              min={1}
              step={1}
              placeholder="e.g. 50"
              value={clientsAssigned}
              onChange={(e) => setClientsAssigned(e.target.value)}
              required
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              How many renewal enquiries you aim to retain this month.
            </p>
          </div>
          <DialogFooter>
            {!required && (
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
            )}
            <Button type="submit" disabled={isSubmitting || !clientsAssigned}>
              {isSubmitting ? 'Saving…' : `Save ${MONTH_NAMES[month - 1]} Target`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
