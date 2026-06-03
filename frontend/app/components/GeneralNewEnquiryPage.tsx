'use client';

/**
 * Standalone page for the General New module.
 *
 * Cloned from MotorEnquiryPage on 2026-05-15. Mirrors Motor New's per-enquiry
 * workflow (client_name, agent FK, remarks, status state machine, revisions,
 * status_changed_at) but WITHOUT the motor-specific chassis_no field — general
 * insurance products don't have a chassis.
 *
 * IMPORTANT: this file was duplicated rather than refactored into a shared
 * base. Future bug fixes in MotorEnquiryPage need to be mirrored here too.
 *
 * Tabs: Dashboard | Tracker View | Enquiries
 *   - Dashboard: 6 stat cards driven by /stats/
 *   - Tracker View: PersonalDailyTracker (everyone) + admin-only team TrackerView
 *   - Enquiries: filter bar + paginated DataTable + inline RemarksPanel
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { RemarksPanel } from '@/app/components/RemarksPanel';
import { EnquiryStatusModal } from '@/app/components/EnquiryStatusModal';
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
import { formatDate } from '@/app/lib/date';
import { useAddShortcut } from '@/app/lib/useAddShortcut';
import { useSubmitShortcut } from '@/app/lib/useSubmitShortcut';
import {
  fetchApi,
  getUsersForModule,
  getUsersForModulePage,
  getInsuranceCompaniesPage,
  getClassOfInsurancePage,
  getMotorEnquiryStats,
  updateMotorEnquiryStatus,
  updateMotorEnquiryRevisions,
  getCurrentMotorRenewalMonthlyTarget,
  getMotorRenewalMonthlyTargets,
  createMotorRenewalMonthlyTarget,
  updateMotorRenewalMonthlyTarget,
  getRemarksContentTypes,
  REMARKS_MODEL_NAME_BY_API_SLUG,
  type MotorRenewalMonthlyTarget,
  type MotorEnquiryEntry,
  type MotorEnquiryStats,
  type MotorEnquiryModule,
  type MotorRenewalModule,
} from '@/app/lib/api';

// ─── Per-module configuration ────────────────────────────────────────────────
// Motor New uses 'converted' as the positive outcome; Motor Renewal uses
// 'retained'. Everything that depends on the success-status (label, badge
// color, allowed transitions, status filter options, dashboard card label) is
// driven by this config so the rest of the component stays generic.
type SuccessStatus = 'converted' | 'retained';

interface ModuleStatusConfig {
  options: Array<{ value: MotorEnquiryEntry['status']; label: string }>;
  successValue: SuccessStatus;
  successLabel: string;
  totalLabel: string;
  showRatioCard: boolean;
}

const STATUS_CONFIG: Record<MotorEnquiryModule, ModuleStatusConfig> = {
  'general-new': {
    options: [
      { value: 'new', label: 'New Enquiry' },
      { value: 'converted', label: 'Converted' },
      { value: 'lost', label: 'Lost' },
    ],
    successValue: 'converted',
    successLabel: 'Converted',
    totalLabel: 'Total Enquiries',
    showRatioCard: false,
  },
  'motor-new': {
    options: [
      { value: 'new', label: 'New Enquiry' },
      { value: 'converted', label: 'Converted' },
      { value: 'lost', label: 'Lost' },
    ],
    successValue: 'converted',
    successLabel: 'Converted',
    totalLabel: 'Total Enquiries',
    showRatioCard: false,
  },
  'motor-renewal': {
    options: [
      { value: 'new', label: 'New Enquiry' },
      { value: 'retained', label: 'Retained' },
      { value: 'lost', label: 'Lost' },
    ],
    successValue: 'retained',
    successLabel: 'Retained',
    totalLabel: 'Total Enquiries Added',
    showRatioCard: true,
  },
  'motor-fleet-new': {
    options: [
      { value: 'new', label: 'New Enquiry' },
      { value: 'converted', label: 'Converted' },
      { value: 'lost', label: 'Lost' },
    ],
    successValue: 'converted',
    successLabel: 'Converted',
    totalLabel: 'Total Enquiries',
    showRatioCard: false,
  },
  'motor-fleet-renewal': {
    options: [
      { value: 'new', label: 'New Enquiry' },
      { value: 'retained', label: 'Retained' },
      { value: 'lost', label: 'Lost' },
    ],
    successValue: 'retained',
    successLabel: 'Retained',
    totalLabel: 'Total Enquiries Added',
    showRatioCard: true,
  },
};

const STATUS_COLORS: Record<MotorEnquiryEntry['status'], string> = {
  new: 'bg-blue-100 text-blue-800',
  converted: 'bg-green-100 text-green-800',
  retained: 'bg-green-100 text-green-800',
  lost: 'bg-red-100 text-red-800',
};

function StatusBadge({
  status,
  label,
}: {
  status: MotorEnquiryEntry['status'];
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

export function GeneralNewEnquiryPage() {
  const moduleKey = 'general_new' as const;
  const apiSlug: MotorEnquiryModule = 'general-new';
  const title = 'General New';
  const config = STATUS_CONFIG[apiSlug];
  const statusLabelFor = useCallback(
    (value: MotorEnquiryEntry['status']) => {
      const opt = config.options.find((o) => o.value === value);
      return opt?.label ?? value;
    },
    [config]
  );

  const { canSeeAllData, user, isHOD } = useAuth();
  const isHodUser = isHOD();
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

  // Filters (Enquiries tab) — local URL-less state because the page is tab-driven.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [userId, setUserId] = useState('');     // who added the row
  const [agentId, setAgentId] = useState('');   // FK Source/Agent
  const [statusFilter, setStatusFilter] = useState('');
  const [clientName, setClientName] = useState('');

  // Dashboard filters (independent of enquiries filters to avoid coupling).
  const [dashFrom, setDashFrom] = useState('');
  const [dashTo, setDashTo] = useState('');
  const [dashUserId, setDashUserId] = useState('');

  // Data
  const [entries, setEntries] = useState<MotorEnquiryEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  // Start with zeros so the dashboard renders cards immediately on first paint;
  // they'll update once /stats/ resolves.
  const [stats, setStats] = useState<MotorEnquiryStats>({
    total: 0,
    revised: 0,
    converted: 0,
    retained: 0,
    lost: 0,
    avg_tat_minutes: null,
    avg_accuracy: null,
    converted_premium: 0,
    lost_premium: 0,
    total_potential_premium: 0,
  });

  // Tracker — month state + entries
  const [personalCalYear, setPersonalCalYear] = useState(today.getFullYear());
  const [personalCalMonth, setPersonalCalMonth] = useState(today.getMonth());
  const [teamCalYear, setTeamCalYear] = useState(today.getFullYear());
  const [teamCalMonth, setTeamCalMonth] = useState(today.getMonth());
  const [trackerUserFilter, setTrackerUserFilter] = useState<string>('all');
  const [monthEntries, setMonthEntries] = useState<MotorEnquiryEntry[]>([]);

  // Module + sales-KPI user pools
  const [moduleUsers, setModuleUsers] = useState<ModuleUser[]>([]);
  const [salesUsers, setSalesUsers] = useState<ModuleUser[]>([]);

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<MotorEnquiryEntry | null>(null);
  const [modalError, setModalError] = useState('');

  // Status-change verification modal
  const [pendingStatus, setPendingStatus] = useState<{
    entry: MotorEnquiryEntry;
    newStatus: SuccessStatus | 'lost';
  } | null>(null);

  // Remarks side panel
  const [panelEntry, setPanelEntry] = useState<MotorEnquiryEntry | null>(null);
  const [ctMap, setCtMap] = useState<Record<string, number>>({});
  useEffect(() => {
    getRemarksContentTypes().then((res) => {
      if (res.data) setCtMap(res.data);
    });
  }, []);
  const remarksContentTypeId = ctMap[REMARKS_MODEL_NAME_BY_API_SLUG[apiSlug]] ?? null;

  // ── Renewal monthly target ──────────────────────────────────────────────
  // Used when apiSlug is a renewal module (motor-renewal or motor-fleet-renewal).
  // The card displays the target for `targetCardYear/Month` (1-indexed);
  // `targetCard` is the row currently displayed, `targetActuals` is the count
  // of `status='retained'` enquiries in that month for the logged-in user.
  const [targetCardYear, setTargetCardYear] = useState(today.getFullYear());
  const [targetCardMonth, setTargetCardMonth] = useState(today.getMonth() + 1);
  const [targetCard, setTargetCard] = useState<MotorRenewalMonthlyTarget | null>(null);
  const [targetActuals, setTargetActuals] = useState(0);
  const [isTargetModalOpen, setIsTargetModalOpen] = useState(false);
  const [currentTargetLoaded, setCurrentTargetLoaded] = useState(false);
  const [currentTarget, setCurrentTarget] = useState<MotorRenewalMonthlyTarget | null>(null);

  // Right-side "Monthly Targets" panel — same UX as Sales KPI's panel.
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [sheetYear, setSheetYear] = useState(today.getFullYear());
  const [sheetTargets, setSheetTargets] = useState<MotorRenewalMonthlyTarget[]>([]);
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

      const result = await fetchApi<{ results: MotorEnquiryEntry[]; count: number }>(
        `/api/entries/${apiSlug}/?${qs}`
      );
      setEntries(result.data?.results || []);
      setTotalCount(result.data?.count || 0);
    } finally {
      setIsLoading(false);
    }
  }, [apiSlug, page, pageSize, dateFrom, dateTo, userId, agentId, statusFilter, clientName]);

  const fetchStats = useCallback(async () => {
    const result = await getMotorEnquiryStats(apiSlug, {
      date_from: dashFrom || undefined,
      date_to: dashTo || undefined,
      user_id: dashUserId || undefined,
    });
    if (result.data) {
      setStats(result.data);
    } else {
      console.error('Failed to load motor enquiry stats:', result.error);
      toast.error(result.error || 'Failed to load dashboard stats');
    }
  }, [apiSlug, dashFrom, dashTo, dashUserId]);

  const fetchMonthEntries = useCallback(async () => {
    // Pull a wide window covering both the personal month and the team month.
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
          return fetchApi<{ results: MotorEnquiryEntry[] }>(
            `/api/entries/${apiSlug}/?${qs}`
          );
        })
      );
      const merged = new Map<number, MotorEnquiryEntry>();
      for (const res of responses) {
        for (const entry of res.data?.results ?? []) {
          merged.set(entry.id, entry);
        }
      }
      setMonthEntries(Array.from(merged.values()));
    } catch {
      setMonthEntries([]);
    }
  }, [apiSlug, personalCalYear, personalCalMonth, teamCalYear, teamCalMonth]);

  // ── Motor Renewal target fetchers ─────────────────────────────────────────
  // General New has no monthly retention target — these are renewal-only.
  // Hardcoded false so the renewal-target code paths below are unreachable;
  // they remain in the file because this component was cloned from
  // MotorEnquiryPage and the dead branches help keep diffs against the source
  // small for future bug-fix mirroring.
  const isRenewal = false;
  const renewalModule = apiSlug as MotorRenewalModule;

  const fetchCurrentTarget = useCallback(async () => {
    if (!isRenewal) return;
    const result = await getCurrentMotorRenewalMonthlyTarget(renewalModule);
    setCurrentTarget(result.data ?? null);
    setCurrentTargetLoaded(true);
  }, [isRenewal, renewalModule]);

  const fetchSheetTargets = useCallback(async () => {
    if (!isRenewal) return;
    const result = await getMotorRenewalMonthlyTargets(renewalModule, { year: sheetYear });
    setSheetTargets(result.data ?? []);
  }, [isRenewal, renewalModule, sheetYear]);

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
      ? await updateMotorRenewalMonthlyTarget(renewalModule, existing.id, { clients_assigned: value })
      : await createMotorRenewalMonthlyTarget(renewalModule, {
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
      // Sync the floating card if the edited month is what it's showing.
      if (sheetYear === targetCardYear && month === targetCardMonth) {
        fetchTargetCard();
      }
      // And refresh the "current month" gate so the auto-open dialog logic
      // resolves correctly afterwards.
      if (sheetYear === today.getFullYear() && month === today.getMonth() + 1) {
        fetchCurrentTarget();
      }
    } else {
      toast.error(result.error || 'Failed to save target.');
    }
  };

  const fetchTargetCard = useCallback(async () => {
    if (!isRenewal) return;
    // Fetch the target row for the displayed month + count of retained
    // enquiries in that same month for the logged-in user.
    const [targetResult, statsResult] = await Promise.all([
      getMotorRenewalMonthlyTargets(renewalModule, {
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
        return fetchApi<{ count: number }>(`/api/entries/${apiSlug}/?${qs}`);
      })(),
    ]);
    setTargetCard(targetResult.data?.[0] ?? null);
    setTargetActuals(statsResult.data?.count ?? 0);
  }, [isRenewal, renewalModule, apiSlug, targetCardYear, targetCardMonth, currentUserId]);

  // ── Initial loads ────────────────────────────────────────────────────────
  useEffect(() => {
    getUsersForModule(moduleKey).then((r) => {
      if (r.data) setModuleUsers(r.data);
    });
    getUsersForModule('sales_kpi').then((r) => {
      if (r.data) setSalesUsers(r.data);
    });
  }, [moduleKey]);

  useEffect(() => {
    if (activeView === 'enquiries') fetchEntries();
  }, [activeView, fetchEntries]);

  useEffect(() => {
    if (activeView === 'dashboard') fetchStats();
  }, [activeView, fetchStats]);

  useEffect(() => {
    if (activeView === 'tracker') fetchMonthEntries();
  }, [activeView, fetchMonthEntries]);

  // Motor Renewal target: load once, then keep card in sync with card month.
  useEffect(() => {
    fetchCurrentTarget();
  }, [fetchCurrentTarget]);

  useEffect(() => {
    fetchTargetCard();
  }, [fetchTargetCard]);

  // True once the /current/ call resolves and finds no target for this month.
  // Blocks all data-entry mutations on the page until cleared.
  const noCurrentTarget = isRenewal && currentTargetLoaded && !currentTarget;
  const isCurrentMonthCard =
    targetCardYear === today.getFullYear() &&
    targetCardMonth === today.getMonth() + 1;

  // Auto-open the edit modal for new users on first visit (no current target).
  useEffect(() => {
    if (noCurrentTarget) {
      setIsTargetModalOpen(true);
    }
  }, [noCurrentTarget]);

  // Load the 12-month targets each time the right-side panel opens or its year changes.
  useEffect(() => {
    if (isPanelOpen) fetchSheetTargets();
  }, [isPanelOpen, sheetYear, fetchSheetTargets]);

  // ── Mutations ────────────────────────────────────────────────────────────
  const refreshAfterMutation = () => {
    fetchEntries();
    fetchStats();
    fetchMonthEntries();
    if (isRenewal) fetchTargetCard();
  };

  const handleSaveNew = async (payload: {
    client_name: string;
    agent: number;
    remarks: string;
    quotes_compared: number;
    potential_premium: string | null;
    class_of_insurance: number | null;
    insurance_company: number | null;
  }) => {
    setModalError('');
    const isEdit = !!editingEntry;
    const url = isEdit
      ? `/api/entries/${apiSlug}/${editingEntry!.id}/`
      : `/api/entries/${apiSlug}/`;
    // Remarks textarea is hidden on edit; on create, the typed text becomes
    // the entry's first EntryRemark via the write-only `initial_remark` field.
    const { remarks, ...rest } = payload;
    const body = isEdit
      ? rest
      : { date: toLocalDateString(today), ...rest, initial_remark: remarks };
    const result = await fetchApi<MotorEnquiryEntry>(url, {
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

  const openAddModal = () => {
    if (noCurrentTarget) {
      setIsTargetModalOpen(true);
      return;
    }
    setEditingEntry(null);
    setModalError('');
    setIsModalOpen(true);
  };
  // TED-483: "C" anywhere on the page triggers the same Add flow as the button.
  useAddShortcut(openAddModal, {
    enabled: !isHodUser && !isModalOpen && !isTargetModalOpen,
  });

  const handleDelete = async (entry: MotorEnquiryEntry) => {
    const ok = await confirm({
      title: 'Delete enquiry?',
      description: 'This action cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    const result = await fetchApi<void>(`/api/entries/${apiSlug}/${entry.id}/`, {
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

  const updateRevisions = async (entry: MotorEnquiryEntry, newCount: number) => {
    if (newCount < 0) return;
    // Optimistic update.
    setEntries((curr) =>
      curr.map((e) => (e.id === entry.id ? { ...e, revisions: newCount } : e))
    );
    const result = await updateMotorEnquiryRevisions(apiSlug, entry.id, newCount);
    if (!result.data) {
      // Roll back on failure.
      setEntries((curr) =>
        curr.map((e) => (e.id === entry.id ? { ...e, revisions: entry.revisions } : e))
      );
      toast.error(result.error || 'Failed to update revisions');
    }
  };

  const applyStatusChange = async (
    entry: MotorEnquiryEntry,
    newStatus: SuccessStatus | 'lost',
    revisions?: number,
    convertedPremium?: string,
  ) => {
    const result = await updateMotorEnquiryStatus(apiSlug, entry.id, {
      status: newStatus,
      ...(revisions != null ? { revisions } : {}),
      ...(convertedPremium ? { converted_premium: convertedPremium } : {}),
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
      render: (item: MotorEnquiryEntry) => item.pib_id,
    },
    { key: 'client_name', header: 'Client Name' },
    {
      key: 'status',
      header: 'Status',
      render: (item: MotorEnquiryEntry) =>
        item.is_terminal || item.allowed_transitions.length === 0 ? (
          <StatusBadge status={item.status} label={statusLabelFor(item.status)} />
        ) : (
          <Select
            value={item.status}
            onValueChange={(v) => {
              if (v === config.successValue || v === 'lost') {
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
                  {statusLabelFor(s as MotorEnquiryEntry['status'])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ),
    },
    {
      key: 'class_of_insurance',
      header: 'Class of Insurance',
      render: (item: MotorEnquiryEntry) =>
        (item.class_of_insurance_display as string | null | undefined) || '—',
    },
    {
      key: 'added_by_name',
      header: 'Added by',
      render: (item: MotorEnquiryEntry) => <AddedByCell entry={item} />,
    },
    { key: 'agent_name', header: 'Agent Name' },
    {
      key: 'insurance_company',
      header: 'Insurance Company',
      render: (item: MotorEnquiryEntry) =>
        (item.insurance_company_name as string | undefined) || '—',
    },
    {
      key: 'revisions',
      header: 'Revisions',
      render: (item: MotorEnquiryEntry) => {
        // Read-only once the enquiry has been closed (converted/lost).
        if (item.status !== 'new') {
          return <span className="text-sm text-[#374151]">{item.revisions}</span>;
        }
        // While status=new, anyone with table access can bump the counter inline.
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
      render: (item: MotorEnquiryEntry) => item.tat_display || '—',
    },
    {
      key: 'accuracy_pct',
      header: 'Accuracy',
      render: (item: MotorEnquiryEntry) => formatAccuracy(item.accuracy_pct),
    },
    {
      key: 'quotes_compared',
      header: 'No. of Quotes Compared',
      render: (item: MotorEnquiryEntry) => item.quotes_compared,
    },
    {
      key: 'potential_premium',
      header: 'Potential Premium',
      render: (item: MotorEnquiryEntry) => {
        const raw = item.potential_premium as string | null | undefined;
        if (raw == null || raw === '') return '—';
        const n = Number(raw);
        return Number.isFinite(n) ? n.toLocaleString() : raw;
      },
    },
    {
      key: 'converted_premium',
      header: 'Converted Premium',
      render: (item: MotorEnquiryEntry) => {
        const raw = item.converted_premium as string | null | undefined;
        if (raw == null || raw === '') return '—';
        const n = Number(raw);
        return Number.isFinite(n) ? n.toLocaleString() : raw;
      },
    },
    {
      key: 'added_at',
      header: 'Added on',
      render: (item: MotorEnquiryEntry) => formatDate(item.added_at.split('T')[0]),
    },
    {
      key: 'notes',
      header: 'Notes',
      render: (item: MotorEnquiryEntry) => (
        <button
          type="button"
          onClick={() => setPanelEntry(item)}
          className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-[#F3F3F3]"
          aria-label="View remarks"
        >
          <FileText
            className={
              'h-4 w-4 ' +
              (Number(item.remark_count) > 0 ? 'text-[#6366F1]' : 'text-[#71717A]')
            }
          />
        </button>
      ),
    },
  ];

  const hasActiveFilters =
    !!(dateFrom || dateTo || userId || agentId || statusFilter || clientName);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className={isRenewal ? 'p-6 flex gap-6 items-start' : 'p-6 space-y-6'}>
      <div className={isRenewal ? 'flex-1 min-w-0 space-y-6' : 'contents'}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{title}</h1>
        <div className="flex items-center gap-2">
          {isRenewal && (
            <Button variant="outline" onClick={() => setIsPanelOpen((o) => !o)}>
              <Pencil className="h-4 w-4 mr-2" />
              Monthly Targets
            </Button>
          )}
        </div>
      </div>

      {/* Motor Renewal Client Retention target card — sits between the page
          header and the tabs, matching Sales KPI's Monthly Target placement. */}
      {isRenewal && (
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
      )}

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
                    moduleKey,
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
            {config.showRatioCard && (
              <RatioCard
                label={`${config.successLabel} / Total Assigned Clients`}
                total={stats.total}
                success={stats[config.successValue]}
              />
            )}
            <StatCard label={config.totalLabel} value={stats.total} accent="text-[#09090B]" />
            <StatCard label="Enquiries Revised" value={stats.revised} accent="text-[#A855F7]" />
            <StatCard
              label={config.successLabel}
              value={stats[config.successValue]}
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
            <StatCard
              label={`${config.successLabel} Premium`}
              value={formatPremium(stats.converted_premium)}
              accent="text-green-700"
            />
            <StatCard
              label="Lost Potential Premium"
              value={formatPremium(stats.lost_premium)}
              accent="text-red-700"
            />
            <RatioCard
              label={`${config.successLabel} vs Potential Premium`}
              total={stats.total_potential_premium ?? 0}
              success={stats.converted_premium ?? 0}
            />
          </div>
        </TabsContent>

        {/* ─── Tracker View ─────────────────────────────────────────────── */}
        <TabsContent value="tracker" className="mt-4 space-y-4">
          {!isHodUser && (
            <PersonalDailyTracker<MotorEnquiryEntry>
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
          )}
          {(isAdmin || isHodUser) && (
            <TrackerView<MotorEnquiryEntry>
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
                      moduleKey,
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
                options: config.options.map((o) => ({ value: o.value, label: o.label })),
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
            {!isHodUser && (
              <Button
                disabled={noCurrentTarget}
                title={noCurrentTarget ? "Set this month's retention target first" : undefined}
                onClick={openAddModal}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Enquiry
              </Button>
            )}
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
              entryLabel={panelEntry ? `${title} — ${panelEntry.pib_id}` : ''}
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

      {/* ── Status transition verification modal (TED-440) ───────────── */}
      {pendingStatus && (
        <EnquiryStatusModal
          entry={pendingStatus.entry}
          newStatus={pendingStatus.newStatus}
          newStatusLabel={statusLabelFor(pendingStatus.newStatus)}
          needsConvertedPremium={pendingStatus.newStatus !== 'lost'}
          onCancel={() => setPendingStatus(null)}
          onConfirm={({ revisions, converted_premium }) =>
            applyStatusChange(
              pendingStatus.entry,
              pendingStatus.newStatus,
              revisions,
              converted_premium,
            )
          }
        />
      )}

      {/* ── Client Retention edit-target modal (renewal modules only) ────── */}
      {isRenewal && (
        <MotorRenewalTargetModal
          module={renewalModule}
          isOpen={isTargetModalOpen}
          // While the user has no current-month target, force the modal onto
          // the current month regardless of which card month is displayed —
          // they must satisfy the gate before doing anything else.
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
      )}
      </div>

      {/* ── Right-side Monthly Targets panel (renewal modules only) ────────── */}
      {isRenewal && isPanelOpen && (
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
                    <Label htmlFor={`mr-target-${m}`} className="text-sm">
                      Client Retention
                    </Label>
                    <Input
                      id={`mr-target-${m}`}
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
          {success.toLocaleString()} / {total.toLocaleString()}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">({pct.toFixed(1)}%)</div>
      </CardContent>
    </Card>
  );
}

function formatPremium(n: number | null | undefined): string {
  if (n == null) return '0';
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
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
  entry: MotorEnquiryEntry | null;
  onSave: (payload: {
    client_name: string;
    agent: number;
    remarks: string;
    quotes_compared: number;
    potential_premium: string | null;
    class_of_insurance: number | null;
    insurance_company: number | null;
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
  const [potentialPremium, setPotentialPremium] = useState<string>(
    entry?.potential_premium != null ? String(entry.potential_premium) : ''
  );
  const [classOfInsuranceId, setClassOfInsuranceId] = useState<number | null>(
    typeof entry?.class_of_insurance === 'number' ? entry.class_of_insurance : null,
  );
  const [insurerId, setInsurerId] = useState<number | null>(
    typeof entry?.insurance_company === 'number' ? entry.insurance_company : null
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  // TED-484: Ctrl+Enter / Cmd+Enter submits via the form's onSubmit handler.
  const formRef = useRef<HTMLFormElement>(null);
  useSubmitShortcut(formRef);

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

  const insurerFetchPage = useCallback(
    async ({ search, page }: { search: string; page: number }) => {
      const res = await getInsuranceCompaniesPage({ search, page });
      return {
        results: res.data?.results ?? [],
        hasMore: res.data?.has_more ?? false,
      };
    },
    []
  );

  const classOfInsuranceFetchPage = useCallback(
    async ({ search, page }: { search: string; page: number }) => {
      const res = await getClassOfInsurancePage({ search, page });
      return {
        results: res.data?.results ?? [],
        hasMore: res.data?.has_more ?? false,
      };
    },
    [],
  );

  useEffect(() => {
    setClientName(entry?.client_name ?? '');
    setAgentId(entry?.agent ?? null);
    setRemarks('');
    setQuotesCompared(entry?.quotes_compared != null ? String(entry.quotes_compared) : '0');
    setPotentialPremium(entry?.potential_premium != null ? String(entry.potential_premium) : '');
    setClassOfInsuranceId(
      typeof entry?.class_of_insurance === 'number' ? entry.class_of_insurance : null,
    );
    setInsurerId(typeof entry?.insurance_company === 'number' ? entry.insurance_company : null);
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
      potential_premium: potentialPremium.trim() === '' ? null : potentialPremium.trim(),
      class_of_insurance: classOfInsuranceId,
      insurance_company: insurerId,
    });
    setIsSubmitting(false);
  };

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-4 p-4">
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

      <div className="grid grid-cols-2 gap-3">
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
        <div className="space-y-2">
          <Label>Class of Insurance</Label>
          <SearchableSelect
            value={classOfInsuranceId ? String(classOfInsuranceId) : null}
            onValueChange={(v) => setClassOfInsuranceId(v ? Number(v) : null)}
            placeholder="Select class"
            emptyLabel="No classes found"
            clearLabel="None"
            selectedLabel={(entry?.class_of_insurance_display as string | null | undefined) ?? null}
            getOptionValue={(c) => String(c.id)}
            getOptionLabel={(c) => c.name}
            fetchPage={classOfInsuranceFetchPage}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Insurance Company</Label>
        <SearchableSelect
          value={insurerId ? String(insurerId) : null}
          onValueChange={(v) => setInsurerId(v ? Number(v) : null)}
          placeholder="Select insurance company"
          emptyLabel="No insurance companies found"
          clearLabel="None"
          selectedLabel={entry?.insurance_company_name ?? null}
          getOptionValue={(c) => String(c.id)}
          getOptionLabel={(c) => c.name}
          fetchPage={insurerFetchPage}
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

// ─── Client Retention monthly target card (renewal modules only) ────────────

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
  target: MotorRenewalMonthlyTarget | null;
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

function MotorRenewalTargetModal({
  module,
  isOpen,
  year,
  month,
  existing,
  required,
  onClose,
  onSaved,
}: {
  module: MotorRenewalModule;
  isOpen: boolean;
  year: number;
  month: number;
  existing: MotorRenewalMonthlyTarget | null;
  required?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [clientsAssigned, setClientsAssigned] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const formRef = useRef<HTMLFormElement>(null);
  useSubmitShortcut(formRef, { enabled: isOpen });

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
      ? await updateMotorRenewalMonthlyTarget(module, existing.id, { clients_assigned: value })
      : await createMotorRenewalMonthlyTarget(module, { year, month, clients_assigned: value });
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
        // In required mode, block close attempts entirely.
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
        <form ref={formRef} onSubmit={handleSubmit} className="p-4 space-y-4">
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
