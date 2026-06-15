'use client';

/**
 * Motor Claim — 3-tab standalone page (Dashboard | Tracker View | Enquiries).
 * Mirrors the layout of MotorEnquiryPage but doesn't share its code because
 * Motor Claim has its own data model (no revisions, no accuracy, no monthly
 * target) plus FK lookups for Type of Accident + Insurance Company.
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
import { Plus, CalendarIcon, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';

import { DataTable } from '@/app/components/DataTable';
import { FilterBar } from '@/app/components/FilterBar';
import { RemarksPanel } from '@/app/components/RemarksPanel';
import {
  AddedByCell,
  PersonalDailyTracker,
  TrackerView,
  toLocalDateString,
  type ModuleUser,
} from '@/app/components/KpiModulePage';
import { useAuth } from '@/app/context/AuthContext';
import { canModifyEntry } from '@/app/lib/permissions';
import { useConfirm } from '@/app/components/ConfirmDialog';
import { formatDate } from '@/app/lib/date';
import { useAddShortcut } from '@/app/lib/useAddShortcut';
import { useSubmitShortcut } from '@/app/lib/useSubmitShortcut';
import { FormDatePicker } from '@/components/ui/form-date-picker';
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
  fetchApi,
  getUsersForModule,
  getUsersForModulePage,
  getMotorClaimStats,
  updateMotorClaimStatus,
  updateMotorClaimNextCallDate,
  getAccidentTypes,
  getAccidentTypesPage,
  getInsuranceCompanies,
  getInsuranceCompaniesPage,
  getRemarksContentTypes,
  REMARKS_MODEL_NAME_BY_API_SLUG,
  type MotorClaimEntry,
  type MotorClaimStats,
  type AccidentType,
  type InsuranceCompany,
} from '@/app/lib/api';

const STATUS_OPTIONS: Array<{ value: MotorClaimEntry['status']; label: string }> = [
  { value: 'claims_opened', label: 'Claims Opened' },
  { value: 'claims_in_progress', label: 'Claims In Progress' },
  { value: 'claims_resolved', label: 'Claims Resolved' },
  { value: 'claims_rejected', label: 'Claims Rejected' },
];

const STATUS_LABEL: Record<MotorClaimEntry['status'], string> = {
  claims_opened: 'Claims Opened',
  claims_in_progress: 'Claims In Progress',
  claims_resolved: 'Claims Resolved',
  claims_rejected: 'Claims Rejected',
};

const STATUS_COLORS: Record<MotorClaimEntry['status'], string> = {
  claims_opened: 'bg-blue-100 text-blue-800',
  claims_in_progress: 'bg-yellow-100 text-yellow-800',
  claims_resolved: 'bg-green-100 text-green-800',
  claims_rejected: 'bg-red-100 text-red-800',
};

function StatusBadge({ status }: { status: MotorClaimEntry['status'] }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[status] || ''}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export default function MotorClaimPage() {
  const { canSeeAllData, user, isHOD } = useAuth();
  const confirm = useConfirm();
  const isAdmin = canSeeAllData();
  const isHodUser = isHOD();
  const currentUserId = user?.id;
  const userFullName = user?.full_name ?? '';

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const [activeView, setActiveView] = useState<'dashboard' | 'tracker' | 'enquiries'>('enquiries');

  // Enquiries filters
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  // Preset for the Next call date filter. Empty = no filter; 'custom' reveals
  // a date range picker. The other presets compute from/to off `today` each
  // time fetchEntries runs (see resolveNextCallBounds below).
  const [nextCallPreset, setNextCallPreset] = useState('');
  const [nextCallFrom, setNextCallFrom] = useState('');
  const [nextCallTo, setNextCallTo] = useState('');
  const [userId, setUserId] = useState('');
  const [agentId, setAgentId] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [accidentTypeFilter, setAccidentTypeFilter] = useState('');
  const [insurerFilter, setInsurerFilter] = useState('');
  const [clientNameFilter, setClientNameFilter] = useState('');

  // Dashboard filters (independent so Dashboard date range doesn't tug
  // the Enquiries tab around when switching).
  const [dashFrom, setDashFrom] = useState('');
  const [dashTo, setDashTo] = useState('');
  const [dashUserId, setDashUserId] = useState('');

  // Data
  const [entries, setEntries] = useState<MotorClaimEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [stats, setStats] = useState<MotorClaimStats>({
    claims_opened: 0,
    claims_pending: 0,
    claims_closed: 0,
    claims_in_progress: 0,
    claims_resolved: 0,
    claims_rejected: 0,
  });

  // Tracker state
  const [personalCalYear, setPersonalCalYear] = useState(today.getFullYear());
  const [personalCalMonth, setPersonalCalMonth] = useState(today.getMonth());
  const [teamCalYear, setTeamCalYear] = useState(today.getFullYear());
  const [teamCalMonth, setTeamCalMonth] = useState(today.getMonth());
  const [trackerUserFilter, setTrackerUserFilter] = useState('all');
  const [monthEntries, setMonthEntries] = useState<MotorClaimEntry[]>([]);

  // Module + agent (sales_kpi) + lookup pools
  const [moduleUsers, setModuleUsers] = useState<ModuleUser[]>([]);
  const [salesUsers, setSalesUsers] = useState<ModuleUser[]>([]);
  const [accidentTypes, setAccidentTypes] = useState<AccidentType[]>([]);
  const [insurers, setInsurers] = useState<InsuranceCompany[]>([]);

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<MotorClaimEntry | null>(null);
  const [modalError, setModalError] = useState('');

  // Cross-module comments panel
  const [panelEntry, setPanelEntry] = useState<MotorClaimEntry | null>(null);
  const [ctMap, setCtMap] = useState<Record<string, number>>({});
  useEffect(() => {
    getRemarksContentTypes().then((res) => {
      if (res.data) setCtMap(res.data);
    });
  }, []);
  const remarksContentTypeId = ctMap[REMARKS_MODEL_NAME_BY_API_SLUG['motor-claim']] ?? null;

  // Resolve the Next call date filter's effective from/to bounds based on the
  // selected preset. Computed each call so "Today" always means "today now".
  const resolveNextCallBounds = useCallback((): { from: string; to: string } => {
    const fmt = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };
    const addDays = (base: Date, days: number) => {
      const d = new Date(base);
      d.setDate(d.getDate() + days);
      return d;
    };
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const todayStr = fmt(now);
    switch (nextCallPreset) {
      case 'overdue':
        return { from: '', to: fmt(addDays(now, -1)) };
      case 'today':
        return { from: todayStr, to: todayStr };
      case 'plus1':
        return { from: fmt(addDays(now, 1)), to: fmt(addDays(now, 1)) };
      case 'plus3':
        return { from: fmt(addDays(now, 3)), to: fmt(addDays(now, 3)) };
      case 'plus7':
        return { from: fmt(addDays(now, 7)), to: fmt(addDays(now, 7)) };
      case 'custom':
        return { from: nextCallFrom, to: nextCallTo };
      default:
        return { from: '', to: '' };
    }
  }, [nextCallPreset, nextCallFrom, nextCallTo]);

  // ── Fetchers ─────────────────────────────────────────────────────────────
  const fetchEntries = useCallback(async () => {
    setIsLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set('page', String(page));
      qs.set('page_size', String(pageSize));
      if (dateFrom) qs.set('date_from', dateFrom);
      if (dateTo) qs.set('date_to', dateTo);
      const { from: ncFrom, to: ncTo } = resolveNextCallBounds();
      if (ncFrom) qs.set('next_call_date_from', ncFrom);
      if (ncTo) qs.set('next_call_date_to', ncTo);
      if (userId) qs.set('user_id', userId);
      if (agentId) qs.set('agent_id', agentId);
      if (statusFilter) qs.set('status', statusFilter);
      if (accidentTypeFilter) qs.set('type_of_accident', accidentTypeFilter);
      if (insurerFilter) qs.set('insurance_company', insurerFilter);
      if (clientNameFilter) qs.set('client_name', clientNameFilter);
      const result = await fetchApi<{ results: MotorClaimEntry[]; count: number }>(
        `/api/entries/motor-claim/?${qs}`
      );
      setEntries(result.data?.results || []);
      setTotalCount(result.data?.count || 0);
    } finally {
      setIsLoading(false);
    }
  }, [page, pageSize, dateFrom, dateTo, resolveNextCallBounds, userId, agentId, statusFilter, accidentTypeFilter, insurerFilter, clientNameFilter]);

  const fetchStats = useCallback(async () => {
    const result = await getMotorClaimStats({
      date_from: dashFrom || undefined,
      date_to: dashTo || undefined,
      user_id: dashUserId || undefined,
    });
    if (result.data) setStats(result.data);
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
          return fetchApi<{ results: MotorClaimEntry[] }>(
            `/api/entries/motor-claim/?${qs}`
          );
        })
      );
      const merged = new Map<number, MotorClaimEntry>();
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

  // ── Initial loads ────────────────────────────────────────────────────────
  useEffect(() => {
    getUsersForModule('motor_claim').then((r) => {
      if (r.data) setModuleUsers(r.data);
    });
    getUsersForModule('sales_kpi').then((r) => {
      if (r.data) setSalesUsers(r.data);
    });
    getAccidentTypes({ is_active: true }).then((r) => {
      if (r.data) setAccidentTypes(r.data);
    });
    getInsuranceCompanies({ is_active: true }).then((r) => {
      if (r.data) setInsurers(r.data);
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

  // ── Mutations ────────────────────────────────────────────────────────────
  const refreshAfterMutation = () => {
    fetchEntries();
    fetchStats();
    fetchMonthEntries();
  };

  const handleSave = async (payload: Partial<MotorClaimEntry> & { initial_remark?: string }) => {
    setModalError('');
    const isEdit = !!editingEntry;
    const url = isEdit
      ? `/api/entries/motor-claim/${editingEntry!.id}/`
      : '/api/entries/motor-claim/';
    const body = isEdit
      ? payload
      : {
          date: toLocalDateString(today),
          status: 'claims_opened',
          ...payload,
        };
    const result = await fetchApi<MotorClaimEntry>(url, {
      method: isEdit ? 'PATCH' : 'POST',
      body: JSON.stringify(body),
    });
    if (result.data) {
      setIsModalOpen(false);
      setEditingEntry(null);
      toast.success(isEdit ? 'Claim updated' : 'Claim added');
      refreshAfterMutation();
    } else {
      setModalError(result.error || 'Failed to save claim');
    }
  };

  const openAddModal = () => {
    setEditingEntry(null);
    setModalError('');
    setIsModalOpen(true);
  };
  // TED-483: "C" anywhere on the page triggers the same Add flow as the button.
  useAddShortcut(openAddModal, { enabled: !isHodUser && !isModalOpen });

  const handleDelete = async (entry: MotorClaimEntry) => {
    const ok = await confirm({
      title: 'Delete claim?',
      description: 'This action cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    const result = await fetchApi<void>(`/api/entries/motor-claim/${entry.id}/`, {
      method: 'DELETE',
    });
    if (!result.error) {
      toast.success('Claim deleted');
      refreshAfterMutation();
    } else {
      toast.error(result.error || 'Failed to delete claim');
    }
  };

  const changeStatus = async (entry: MotorClaimEntry, newStatus: MotorClaimEntry['status']) => {
    // Confirm before any non-Opened transition — once the claim leaves
    // "Claims Opened" it can no longer be deleted (see canDelete below).
    if (newStatus !== 'claims_opened') {
      const ok = await confirm({
        title: `Move to ${STATUS_LABEL[newStatus]}?`,
        description: 'This action cannot be undone. Please confirm before proceeding.',
        confirmLabel: 'Proceed',
        cancelLabel: 'Cancel',
      });
      if (!ok) return;
    }
    const result = await updateMotorClaimStatus(entry.id, newStatus);
    if (result.data) {
      toast.success(`Status updated to ${STATUS_LABEL[newStatus]}`);
      refreshAfterMutation();
    } else {
      toast.error(result.error || 'Failed to update status');
    }
  };

  const changeNextCallDate = async (entry: MotorClaimEntry, nextDate: string | null) => {
    // Optimistic — show the new value immediately, roll back on failure.
    const previous = entry.next_call_date;
    setEntries((curr) =>
      curr.map((e) => (e.id === entry.id ? { ...e, next_call_date: nextDate } : e))
    );
    const result = await updateMotorClaimNextCallDate(entry.id, nextDate);
    if (result.data) {
      toast.success(nextDate ? 'Next call date updated' : 'Next call date cleared');
    } else {
      setEntries((curr) =>
        curr.map((e) => (e.id === entry.id ? { ...e, next_call_date: previous } : e))
      );
      toast.error(result.error || 'Failed to update next call date');
    }
  };

  // ── Columns ──────────────────────────────────────────────────────────────
  const columns = [
    {
      key: 'pib_id',
      header: 'ID',
      render: (item: MotorClaimEntry) => item.pib_id,
    },
    { key: 'client_name', header: 'Client Name' },
    {
      key: 'status',
      header: 'Status',
      render: (item: MotorClaimEntry) => {
        if (item.is_terminal || item.allowed_transitions.length === 0 || !canModifyEntry(user, item.added_by)) {
          return <StatusBadge status={item.status} />;
        }
        return (
          <Select
            value={item.status}
            onValueChange={(v) =>
              changeStatus(item, v as MotorClaimEntry['status'])
            }
          >
            <SelectTrigger className="h-8 w-[170px] text-xs shadow-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={item.status} disabled>
                {STATUS_LABEL[item.status]}
              </SelectItem>
              {item.allowed_transitions.map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_LABEL[s as MotorClaimEntry['status']]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      },
    },
    {
      key: 'remarks',
      header: 'Remarks',
      render: (item: MotorClaimEntry) => (
        <button
          type="button"
          aria-label="View remarks"
          className={
            'p-1 rounded hover:bg-zinc-100 ' +
            (item.remark_count > 0 ? 'text-[#6366F1]' : 'text-zinc-700')
          }
          onClick={() => setPanelEntry(item)}
        >
          <FileText className="h-4 w-4" />
        </button>
      ),
    },
    {
      key: 'added_by_name',
      header: 'Added by',
      render: (item: MotorClaimEntry) => <AddedByCell entry={item} />,
    },
    { key: 'vehicle_number', header: 'Vehicle Number' },
    { key: 'claim_number', header: 'Claim Number' },
    {
      key: 'source_name',
      header: 'Source',
      render: (item: MotorClaimEntry) => item.source_name || '—',
    },
    { key: 'type_of_accident_name', header: 'Type of Accident' },
    { key: 'insurance_company_name', header: 'Insurance Company' },
    {
      key: 'next_call_date',
      header: 'Next call date',
      render: (item: MotorClaimEntry) => (
        <InlineDateCell
          value={item.next_call_date}
          onChange={(d) => changeNextCallDate(item, d)}
        />
      ),
    },
    { key: 'garage_name', header: 'Garage Name' },
    { key: 'garage_number', header: 'Garage Number' },
    {
      key: 'tat_display',
      header: 'TAT',
      render: (item: MotorClaimEntry) => item.tat_display || '—',
    },
    {
      key: 'added_at',
      header: 'Added on',
      render: (item: MotorClaimEntry) =>
        formatDate(item.added_at.split('T')[0]),
    },
  ];

  const hasActiveFilters =
    !!(dateFrom || dateTo || nextCallPreset || userId || agentId || statusFilter || accidentTypeFilter || insurerFilter || clientNameFilter);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Motor Claim</h1>
        {!isHodUser && (
          <Button onClick={openAddModal}>
            <Plus className="h-4 w-4 mr-2" />
            Add Claim
          </Button>
        )}
      </div>

      <Tabs
        value={activeView}
        onValueChange={(v) => setActiveView(v as typeof activeView)}
      >
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

        {/* Dashboard */}
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
                    moduleKey: 'motor_claim',
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
          {/* Overview — aggregates */}
          <div className="space-y-3">
            <h2 className="text-base font-semibold text-[#09090B]">Overview</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatCard
                label="Claims Opened"
                value={stats.claims_opened}
                accent="text-blue-700"
              />
              <StatCard
                label="Claims Pending"
                value={stats.claims_pending}
                accent="text-yellow-600"
              />
              <StatCard
                label="Claims Closed"
                value={stats.claims_closed}
                accent="text-green-700"
              />
            </div>
          </div>

          {/* Breakdown — single-status current counts */}
          <div className="space-y-3">
            <h2 className="text-base font-semibold text-[#09090B]">Breakdown</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatCard
                label="Claims In Progress"
                value={stats.claims_in_progress}
                accent="text-yellow-600"
              />
              <StatCard
                label="Claims Resolved"
                value={stats.claims_resolved}
                accent="text-green-700"
              />
              <StatCard
                label="Claims Rejected"
                value={stats.claims_rejected}
                accent="text-red-700"
              />
            </div>
          </div>
        </TabsContent>

        {/* Tracker View */}
        <TabsContent value="tracker" className="mt-4 space-y-4">
          {!isHodUser && (
            <PersonalDailyTracker<MotorClaimEntry>
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
            <TrackerView<MotorClaimEntry>
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

        {/* Enquiries */}
        <TabsContent value="enquiries" className="mt-4 space-y-4">
          <FilterBar
            search={{
              value: clientNameFilter,
              onChange: (v) => {
                setClientNameFilter(v);
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
              label: 'Entry date',
            }}
            presetDateRange={{
              label: 'Next call date',
              preset: nextCallPreset,
              onPresetChange: (p) => {
                setNextCallPreset(p);
                if (p !== 'custom') {
                  setNextCallFrom('');
                  setNextCallTo('');
                }
                setPage(1);
              },
              options: [
                { value: 'overdue', label: 'Overdue' },
                { value: 'today', label: 'Today' },
                { value: 'plus1', label: '1 day from now' },
                { value: 'plus3', label: '3 days from now' },
                { value: 'plus7', label: '1 week from now' },
                { value: 'custom', label: 'Custom' },
              ],
              customFrom: nextCallFrom,
              customTo: nextCallTo,
              onCustomChange: (from, to) => {
                setNextCallFrom(from);
                setNextCallTo(to);
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
                    moduleKey: 'motor_claim',
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
            extraSearchableFilters={[
              {
                label: 'Type of Accident',
                value: accidentTypeFilter,
                onChange: (v) => {
                  setAccidentTypeFilter(v);
                  setPage(1);
                },
                placeholder: 'All Accident Types',
                clearLabel: 'All Accident Types',
                selectedLabel:
                  accidentTypes.find((t) => String(t.id) === accidentTypeFilter)?.name ?? null,
                fetchPage: async ({ search, page }) => {
                  const res = await getAccidentTypesPage({ search, page });
                  return {
                    results: res.data?.results ?? [],
                    hasMore: res.data?.has_more ?? false,
                  };
                },
              },
              {
                label: 'Insurance Company',
                value: insurerFilter,
                onChange: (v) => {
                  setInsurerFilter(v);
                  setPage(1);
                },
                placeholder: 'All Insurers',
                clearLabel: 'All Insurers',
                selectedLabel:
                  insurers.find((c) => String(c.id) === insurerFilter)?.name ?? null,
                fetchPage: async ({ search, page }) => {
                  const res = await getInsuranceCompaniesPage({ search, page });
                  return {
                    results: res.data?.results ?? [],
                    hasMore: res.data?.has_more ?? false,
                  };
                },
              },
            ]}
            hasActiveFilters={hasActiveFilters}
            onClear={() => {
              setDateFrom('');
              setDateTo('');
              setNextCallPreset('');
              setNextCallFrom('');
              setNextCallTo('');
              setUserId('');
              setAgentId('');
              setStatusFilter('');
              setAccidentTypeFilter('');
              setInsurerFilter('');
              setClientNameFilter('');
              setPage(1);
            }}
          />

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
                canEdit={(entry) => entry.is_editable && canModifyEntry(user, entry.added_by)}
                canDelete={(entry) =>
                  entry.added_by === currentUserId && entry.status === 'claims_opened'
                }
                isLoading={isLoading}
              />
            </div>
            <RemarksPanel
              contentTypeId={remarksContentTypeId}
              objectId={panelEntry?.id ?? null}
              canAddComment={panelEntry ? canModifyEntry(user, panelEntry.added_by) : true}
              entryLabel={panelEntry ? `Motor Claim — ${panelEntry.pib_id}` : ''}
              open={!!panelEntry}
              onOpenChange={(open) => {
                if (!open) setPanelEntry(null);
              }}
            />
          </div>
        </TabsContent>
      </Tabs>

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
        <DialogContent className="p-0 sm:max-w-lg">
          <DialogHeader className="border-b border-[#E4E4E4] p-4">
            <DialogTitle>{editingEntry ? 'Edit Claim' : 'New Claim'}</DialogTitle>
          </DialogHeader>
          <ClaimForm
            entry={editingEntry}
            salesUsers={salesUsers}
            error={modalError}
            onSave={handleSave}
            onClose={() => {
              setIsModalOpen(false);
              setEditingEntry(null);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
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

function ClaimForm({
  entry,
  salesUsers,
  onSave,
  onClose,
  error,
}: {
  entry: MotorClaimEntry | null;
  salesUsers: ModuleUser[];
  onSave: (payload: Partial<MotorClaimEntry> & { initial_remark?: string }) => void;
  onClose: () => void;
  error: string;
}) {
  const [clientName, setClientName] = useState(entry?.client_name ?? '');
  const [vehicleNumber, setVehicleNumber] = useState(entry?.vehicle_number ?? '');
  const [claimNumber, setClaimNumber] = useState(entry?.claim_number ?? '');
  const [sourceId, setSourceId] = useState<number | null>(entry?.source ?? null);
  const [accidentTypeId, setAccidentTypeId] = useState<number | null>(
    entry?.type_of_accident ?? null
  );
  const [insurerId, setInsurerId] = useState<number | null>(
    entry?.insurance_company ?? null
  );
  const [nextCallDate, setNextCallDate] = useState(entry?.next_call_date ?? '');
  const [garageName, setGarageName] = useState(entry?.garage_name ?? '');
  const [garageNumber, setGarageNumber] = useState(entry?.garage_number ?? '');
  // Add-mode only: seed the new claim's first comment.
  const [remarks, setRemarks] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  // TED-484: Ctrl+Enter / Cmd+Enter submits via the form's onSubmit handler.
  const formRef = useRef<HTMLFormElement>(null);
  useSubmitShortcut(formRef);

  const sourceFetchPage = useCallback(
    async ({ search, page }: { search: string; page: number }) => {
      const res = await getUsersForModulePage('sales_kpi', { search, page });
      return {
        results: res.data?.results ?? [],
        hasMore: res.data?.has_more ?? false,
      };
    },
    []
  );

  const accidentTypeFetchPage = useCallback(
    async ({ search, page }: { search: string; page: number }) => {
      const res = await getAccidentTypesPage({ search, page });
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

  useEffect(() => {
    setClientName(entry?.client_name ?? '');
    setVehicleNumber(entry?.vehicle_number ?? '');
    setClaimNumber(entry?.claim_number ?? '');
    setSourceId(entry?.source ?? null);
    setAccidentTypeId(entry?.type_of_accident ?? null);
    setInsurerId(entry?.insurance_company ?? null);
    setNextCallDate(entry?.next_call_date ?? '');
    setGarageName(entry?.garage_name ?? '');
    setGarageNumber(entry?.garage_number ?? '');
  }, [entry]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceId || !accidentTypeId || !insurerId) return;
    setIsSubmitting(true);
    const base = {
      client_name: clientName,
      vehicle_number: vehicleNumber,
      claim_number: claimNumber,
      source: sourceId,
      type_of_accident: accidentTypeId,
      insurance_company: insurerId,
      next_call_date: nextCallDate || null,
      garage_name: garageName,
      garage_number: garageNumber,
    };
    // On Add only, seed the first comment from the Remarks textarea.
    onSave(entry ? base : { ...base, initial_remark: remarks });
    setIsSubmitting(false);
  };

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-4 p-4 max-h-[70vh] overflow-y-auto">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-md text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
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
          <Label>Vehicle Number *</Label>
          <Input
            type="text"
            placeholder="e.g. KA-01-AB-1234"
            value={vehicleNumber}
            onChange={(e) => setVehicleNumber(e.target.value)}
            required
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Claim Number *</Label>
          <Input
            type="text"
            placeholder="Enter claim number"
            value={claimNumber}
            onChange={(e) => setClaimNumber(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label>Source / Sales Person *</Label>
          <SearchableSelect
            value={sourceId ? String(sourceId) : null}
            onValueChange={(v) => setSourceId(Number(v))}
            placeholder="Select agent"
            emptyLabel="No agents found"
            selectedLabel={entry?.source_name ?? null}
            getOptionValue={(u) => String(u.id)}
            getOptionLabel={(u) => u.full_name || u.email}
            fetchPage={sourceFetchPage}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Type of Accident *</Label>
          <SearchableSelect
            value={accidentTypeId ? String(accidentTypeId) : null}
            onValueChange={(v) => setAccidentTypeId(Number(v))}
            placeholder="Select type"
            emptyLabel="No accident types found"
            selectedLabel={entry?.type_of_accident_name ?? null}
            getOptionValue={(t) => String(t.id)}
            getOptionLabel={(t) => t.name}
            fetchPage={accidentTypeFetchPage}
          />
        </div>
        <div className="space-y-2">
          <Label>Insurance Company *</Label>
          <SearchableSelect
            value={insurerId ? String(insurerId) : null}
            onValueChange={(v) => setInsurerId(Number(v))}
            placeholder="Select insurer"
            emptyLabel="No insurance companies found"
            selectedLabel={entry?.insurance_company_name ?? null}
            getOptionValue={(c) => String(c.id)}
            getOptionLabel={(c) => c.name}
            fetchPage={insurerFetchPage}
          />
        </div>
      </div>

      <FormDatePicker
        label="Next call date"
        value={nextCallDate}
        onChange={(d) => setNextCallDate(d)}
        disablePast
      />

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Garage Name</Label>
          <Input
            type="text"
            placeholder="Enter garage name"
            value={garageName}
            onChange={(e) => setGarageName(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>Garage Number</Label>
          <Input
            type="text"
            placeholder="Enter garage number"
            value={garageNumber}
            onChange={(e) => setGarageNumber(e.target.value)}
          />
        </div>
      </div>

      {/* Remarks textarea only on Add — on Edit, comments are managed via the
          note icon on the row. The text typed here becomes the new claim's
          first comment via `initial_remark`. */}
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
        <Button
          type="submit"
          disabled={
            isSubmitting ||
            !clientName ||
            !vehicleNumber ||
            !claimNumber ||
            !sourceId ||
            !accidentTypeId ||
            !insurerId
          }
        >
          {isSubmitting ? 'Saving…' : entry ? 'Update' : 'Add Claim'}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ── Inline next-call-date cell ─────────────────────────────────────────────
// Click the date to open a calendar popover; picking a day saves immediately
// via /update-next-call-date/ (bypasses the 30-min edit window).
function InlineDateCell({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (date: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? new Date(value + 'T00:00:00') : undefined;

  const startOfToday = () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  };

  const handleSelect = (d: Date | undefined) => {
    if (!d) {
      onChange(null);
    } else {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      onChange(`${y}-${m}-${day}`);
    }
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-[#E4E4E4] bg-white px-2 py-1 text-sm text-[#374151] shadow-xs hover:bg-[#F3F3F3] transition-colors"
        >
          <CalendarIcon className="h-3.5 w-3.5 text-[#71717A]" />
          <span>{value ? formatDate(value) : '—'}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={handleSelect}
          defaultMonth={selected || new Date()}
          disabled={{ before: startOfToday() }}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}
