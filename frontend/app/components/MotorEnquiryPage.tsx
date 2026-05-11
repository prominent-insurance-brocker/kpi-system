'use client';

/**
 * Shared standalone page for the Motor New + Motor Renewal modules.
 *
 * Both modules share an identical per-enquiry schema (client_name, agent FK,
 * chassis_no, remarks, status state-machine, revisions, status_changed_at),
 * so a single page implementation is reused for both routes.
 *
 * Tabs: Dashboard | Tracker View | Enquiries
 *   - Dashboard: 6 stat cards driven by /stats/
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
import { Plus, Minus, FileText, X, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

import { DataTable } from '@/app/components/DataTable';
import { FilterBar } from '@/app/components/FilterBar';
import {
  AddedByCell,
  PersonalDailyTracker,
  TrackerView,
  toLocalDateString,
  type ModuleUser,
} from '@/app/components/KpiModulePage';
import { useAuth } from '@/app/context/AuthContext';
import { useConfirm } from '@/app/components/ConfirmDialog';
import { formatDate } from '@/app/lib/date';
import {
  fetchApi,
  getUsersForModule,
  getMotorEnquiryStats,
  updateMotorEnquiryStatus,
  updateMotorEnquiryRevisions,
  type MotorEnquiryEntry,
  type MotorEnquiryStats,
  type MotorEnquiryModule,
} from '@/app/lib/api';

const STATUS_OPTIONS: Array<{ value: MotorEnquiryEntry['status']; label: string }> = [
  { value: 'new', label: 'New Enquiry' },
  { value: 'converted', label: 'Converted' },
  { value: 'lost', label: 'Lost' },
];

const STATUS_LABEL: Record<MotorEnquiryEntry['status'], string> = {
  new: 'New Enquiry',
  converted: 'Converted',
  lost: 'Lost',
};

const STATUS_COLORS: Record<MotorEnquiryEntry['status'], string> = {
  new: 'bg-blue-100 text-blue-800',
  converted: 'bg-green-100 text-green-800',
  lost: 'bg-red-100 text-red-800',
};

function StatusBadge({ status }: { status: MotorEnquiryEntry['status'] }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[status] || ''}`}
    >
      {STATUS_LABEL[status]}
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

export interface MotorEnquiryPageProps {
  moduleKey: 'motor_new' | 'motor_renewal';
  apiSlug: MotorEnquiryModule;
  title: string;
  deptLabel: string;
}

export function MotorEnquiryPage({
  moduleKey,
  apiSlug,
  title,
  deptLabel,
}: MotorEnquiryPageProps) {
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
  const [stats, setStats] = useState<MotorEnquiryStats | null>(null);

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
    newStatus: 'converted' | 'lost';
  } | null>(null);

  // Remarks side panel
  const [panelEntry, setPanelEntry] = useState<MotorEnquiryEntry | null>(null);

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
    if (result.data) setStats(result.data);
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

  // ── Mutations ────────────────────────────────────────────────────────────
  const refreshAfterMutation = () => {
    fetchEntries();
    fetchStats();
    fetchMonthEntries();
  };

  const handleSaveNew = async (payload: {
    client_name: string;
    agent: number;
    chassis_no: string;
    remarks: string;
  }) => {
    setModalError('');
    const isEdit = !!editingEntry;
    const url = isEdit
      ? `/api/entries/${apiSlug}/${editingEntry!.id}/`
      : `/api/entries/${apiSlug}/`;
    const body = isEdit
      ? payload
      : { date: toLocalDateString(today), ...payload };
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
    newStatus: 'converted' | 'lost',
    revisions?: number
  ) => {
    const result = await updateMotorEnquiryStatus(apiSlug, entry.id, {
      status: newStatus,
      ...(revisions != null ? { revisions } : {}),
    });
    if (result.data) {
      toast.success(`Marked as ${STATUS_LABEL[newStatus]}`);
      setPendingStatus(null);
      refreshAfterMutation();
    } else {
      toast.error(result.error || 'Failed to update status');
    }
  };

  // ── Columns ──────────────────────────────────────────────────────────────
  const columns = [
    {
      key: 'row',
      header: '#',
      render: (item: MotorEnquiryEntry) => {
        const idx = entries.findIndex((e) => e.id === item.id);
        return (page - 1) * pageSize + idx + 1;
      },
    },
    { key: 'client_name', header: 'Client Name' },
    { key: 'agent_name', header: 'Agent Name' },
    {
      key: 'added_by_name',
      header: 'Added by',
      render: (item: MotorEnquiryEntry) => <AddedByCell entry={item} />,
    },
    { key: 'chassis_no', header: 'Chassis No' },
    {
      key: 'status',
      header: 'Status',
      render: (item: MotorEnquiryEntry) =>
        item.is_terminal || item.allowed_transitions.length === 0 ? (
          <StatusBadge status={item.status} />
        ) : (
          <Select
            value={item.status}
            onValueChange={(v) => {
              if (v === 'converted' || v === 'lost') {
                setPendingStatus({ entry: item, newStatus: v });
              }
            }}
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
                  {STATUS_LABEL[s as MotorEnquiryEntry['status']]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ),
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
          <FileText className="h-4 w-4 text-[#71717A]" />
        </button>
      ),
    },
  ];

  const hasActiveFilters =
    !!(dateFrom || dateTo || userId || agentId || statusFilter || clientName);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="text-muted-foreground">{deptLabel}</p>
        </div>
        {activeView === 'enquiries' && (
          <Button
            onClick={() => {
              setEditingEntry(null);
              setModalError('');
              setIsModalOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Enquiry
          </Button>
        )}
      </div>

      <Tabs value={activeView} onValueChange={(v) => setActiveView(v as typeof activeView)}>
        <TabsList className="bg-[#F3F4F6] rounded-lg p-1 gap-0">
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
                    options: moduleUsers.map((u) => ({
                      value: String(u.id),
                      label: u.full_name || u.email,
                    })),
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
          {stats && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              <StatCard label="Total Enquiries" value={stats.total} accent="text-[#09090B]" />
              <StatCard label="Enquiries Revised" value={stats.revised} accent="text-[#A855F7]" />
              <StatCard label="Converted" value={stats.converted} accent="text-green-700" />
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
          )}
        </TabsContent>

        {/* ─── Tracker View ─────────────────────────────────────────────── */}
        <TabsContent value="tracker" className="mt-4 space-y-4">
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
          {isAdmin && (
            <TrackerView<MotorEnquiryEntry>
              calYear={teamCalYear}
              calMonth={teamCalMonth}
              monthEntries={monthEntries}
              moduleUsers={moduleUsers}
              trackerUserFilter={trackerUserFilter}
              deptLabel={deptLabel}
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
                    options: moduleUsers.map((u) => ({
                      value: String(u.id),
                      label: u.full_name || u.email,
                    })),
                  }
                : undefined
            }
            agent={{
              value: agentId,
              onChange: (v) => {
                setAgentId(v);
                setPage(1);
              },
              options: salesUsers.map((u) => ({
                value: String(u.id),
                label: u.full_name || u.email,
              })),
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

          <div className="flex gap-4">
            <div className={panelEntry ? 'flex-1 min-w-0' : 'flex-1'}>
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
            {panelEntry && (
              <RemarksPanel entry={panelEntry} onClose={() => setPanelEntry(null)} />
            )}
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
            salesUsers={salesUsers}
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
          onCancel={() => setPendingStatus(null)}
          onConfirm={(revisions) =>
            applyStatusChange(pendingStatus.entry, pendingStatus.newStatus, revisions)
          }
        />
      )}
    </div>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────

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

// ─── Remarks side panel ──────────────────────────────────────────────────────

function RemarksPanel({
  entry,
  onClose,
}: {
  entry: MotorEnquiryEntry;
  onClose: () => void;
}) {
  return (
    <aside className="w-[300px] shrink-0 bg-white border border-[#E4E4E4] rounded-2xl shadow-sm overflow-hidden self-start">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#E4E4E4]">
        <h3 className="text-sm font-semibold text-[#09090B]">Remarks</h3>
        <button
          type="button"
          onClick={onClose}
          className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-[#F3F3F3]"
          aria-label="Close remarks panel"
        >
          <X className="h-4 w-4 text-[#71717A]" />
        </button>
      </div>
      <div className="p-4 space-y-3">
        <div className="space-y-1">
          <div className="text-xs uppercase tracking-wide text-[#71717A]">Client</div>
          <div className="text-base font-semibold text-[#09090B]">{entry.client_name}</div>
        </div>
        <div className="space-y-1">
          <div className="text-xs uppercase tracking-wide text-[#71717A]">Remarks</div>
          <div className="text-sm text-[#374151] whitespace-pre-wrap min-h-[80px]">
            {entry.remarks?.trim() || (
              <span className="text-[#9CA3AF] italic">No remarks</span>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}

// ─── Enquiry create/edit form ────────────────────────────────────────────────

function EnquiryForm({
  entry,
  salesUsers,
  onSave,
  onClose,
  error,
}: {
  entry: MotorEnquiryEntry | null;
  salesUsers: ModuleUser[];
  onSave: (payload: {
    client_name: string;
    agent: number;
    chassis_no: string;
    remarks: string;
  }) => void;
  onClose: () => void;
  error: string;
}) {
  const [clientName, setClientName] = useState(entry?.client_name ?? '');
  const [agentId, setAgentId] = useState<number | null>(entry?.agent ?? null);
  const [chassisNo, setChassisNo] = useState(entry?.chassis_no ?? '');
  const [remarks, setRemarks] = useState(entry?.remarks ?? '');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setClientName(entry?.client_name ?? '');
    setAgentId(entry?.agent ?? null);
    setChassisNo(entry?.chassis_no ?? '');
    setRemarks(entry?.remarks ?? '');
  }, [entry]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!agentId) return;
    setIsSubmitting(true);
    onSave({
      client_name: clientName,
      agent: agentId,
      chassis_no: chassisNo,
      remarks,
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
        <Select
          value={agentId ? String(agentId) : undefined}
          onValueChange={(v) => setAgentId(Number(v))}
        >
          <SelectTrigger className="shadow-none">
            <SelectValue placeholder="Select agent" />
          </SelectTrigger>
          <SelectContent>
            {salesUsers.length === 0 ? (
              <div className="px-3 py-2 text-sm text-[#71717A]">No agents available</div>
            ) : (
              salesUsers.map((u) => (
                <SelectItem key={u.id} value={String(u.id)}>
                  {u.full_name || u.email}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Chassis No *</Label>
        <Input
          type="text"
          placeholder="Enter chassis number"
          value={chassisNo}
          onChange={(e) => setChassisNo(e.target.value)}
          required
        />
      </div>

      <div className="space-y-2">
        <Label>Remarks</Label>
        <Textarea
          placeholder="Add notes or remarks…"
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          rows={3}
        />
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting || !clientName || !chassisNo || !agentId}>
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
  onCancel,
  onConfirm,
}: {
  entry: MotorEnquiryEntry;
  newStatus: 'converted' | 'lost';
  onCancel: () => void;
  onConfirm: (revisions?: number) => void;
}) {
  // Two-stage modal:
  //   stage='ask'  → revisions=0 branch question
  //   stage='enter'→ collecting revision count
  //   stage='verify' → revisions>0 confirmation
  const initialStage: 'ask' | 'verify' = entry.revisions > 0 ? 'verify' : 'ask';
  const [stage, setStage] = useState<'ask' | 'enter' | 'verify'>(initialStage);
  const [enteredCount, setEnteredCount] = useState(0);
  const statusLabel = STATUS_LABEL[newStatus];

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
