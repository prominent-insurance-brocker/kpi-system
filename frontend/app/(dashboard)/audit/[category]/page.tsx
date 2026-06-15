'use client';

/**
 * Audit viewer — admin-only. One page per audited category (the dynamic
 * [category] segment maps to an Audit sidebar link). Lists every create /
 * update / delete in that category, newest first, across all users by default,
 * with optional action / user / date filters and a field-level diff dialog.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

import { useAuth } from '@/app/context/AuthContext';
import { firstAccessibleRoute } from '@/app/lib/navigation';
import { AUDIT_CATEGORIES, auditCategoryLabel } from '@/app/lib/audit';
import { DataTable } from '@/app/components/DataTable';
import { FilterBar, type FilterBarOption } from '@/app/components/FilterBar';
import { getAuditLogs, type AuditLog } from '@/app/lib/api';
import { formatDateTime } from '@/app/lib/date';

const DEFAULT_PAGE_SIZE = 20;

const ACTION_OPTIONS: FilterBarOption[] = [
  { value: 'all', label: 'All actions' },
  { value: 'create', label: 'Created' },
  { value: 'update', label: 'Updated' },
  { value: 'delete', label: 'Deleted' },
];

const ACTION_BADGE: Record<string, string> = {
  create: 'bg-green-100 text-green-800',
  update: 'bg-amber-100 text-amber-800',
  delete: 'bg-red-100 text-red-700',
};

// snake_case field / model names -> "Title Case" for display.
function titleCase(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function changeSummary(log: AuditLog): string {
  if (log.action === 'create') return 'Created';
  if (log.action === 'delete') return 'Deleted';
  const keys = Object.keys(log.changes || {});
  if (keys.length === 0) return '—';
  const shown = keys.slice(0, 2).map(titleCase).join(', ');
  return keys.length > 2 ? `${shown} +${keys.length - 2} more` : shown;
}

export default function AuditCategoryPage() {
  const router = useRouter();
  const params = useParams<{ category: string }>();
  const category = params.category;
  const { user, isLoading } = useAuth();

  // Admin gate. Mirrors admin/settings, but strictly is_staff to match the
  // backend IsAdminUser guard on /api/audit/.
  useEffect(() => {
    if (isLoading) return;
    if (!user || !user.is_staff) {
      router.replace(firstAccessibleRoute(user) ?? '/login');
    }
  }, [isLoading, user, router]);

  const isKnownCategory = useMemo(
    () => AUDIT_CATEGORIES.some((c) => c.key === category),
    [category]
  );

  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [action, setAction] = useState('');
  const [actorId, setActorId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<AuditLog | null>(null);

  // Reset paging + filters when switching category via the sidebar (same
  // component instance, different route param).
  useEffect(() => {
    setPage(1);
    setAction('');
    setActorId('');
    setDateFrom('');
    setDateTo('');
  }, [category]);

  const fetchLogs = useCallback(async () => {
    if (!user?.is_staff || !isKnownCategory) return;
    setLoading(true);
    const res = await getAuditLogs({
      category,
      action: action || undefined,
      actor_id: actorId || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      page,
      page_size: pageSize,
    });
    if (res.data) {
      setLogs(res.data.results);
      setTotalCount(res.data.count);
    } else {
      setLogs([]);
      setTotalCount(0);
    }
    setLoading(false);
  }, [user, isKnownCategory, category, action, actorId, dateFrom, dateTo, page, pageSize]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  if (isLoading || !user || !user.is_staff) {
    return null;
  }

  if (!isKnownCategory) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold">Audit</h1>
        <p className="text-muted-foreground mt-2">
          Unknown audit category &ldquo;{category}&rdquo;.
        </p>
      </div>
    );
  }

  const hasActiveFilters = !!(action || actorId || dateFrom || dateTo);

  const columns = [
    {
      key: 'timestamp',
      header: 'When',
      render: (log: AuditLog) => formatDateTime(log.timestamp),
    },
    {
      key: 'actor_name',
      header: 'Who',
      render: (log: AuditLog) => (
        <div className="flex flex-col">
          <span>{log.actor_name}</span>
          {log.actor_email && (
            <span className="text-xs text-[#71717A]">{log.actor_email}</span>
          )}
        </div>
      ),
    },
    {
      key: 'model_label',
      header: 'Type',
      render: (log: AuditLog) => titleCase(log.model_label),
    },
    {
      key: 'action',
      header: 'Action',
      render: (log: AuditLog) => (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
            ACTION_BADGE[log.action] ?? 'bg-gray-100 text-gray-700'
          }`}
        >
          {log.action_display}
        </span>
      ),
    },
    {
      key: 'object_label',
      header: 'Target',
      render: (log: AuditLog) => log.object_label || '—',
    },
    {
      key: 'changes',
      header: 'Changes',
      render: (log: AuditLog) => (
        <div className="flex items-center gap-2">
          <span className="text-[#71717A]">{changeSummary(log)}</span>
          {Object.keys(log.changes || {}).length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setSelected(log)}
            >
              View
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Audit — {auditCategoryLabel(category)}</h1>
        <p className="text-muted-foreground">
          Every create, update and delete in this module, newest first.
        </p>
      </div>

      <FilterBar
        dateRange={{
          from: dateFrom,
          to: dateTo,
          onChange: (from, to) => {
            setDateFrom(from);
            setDateTo(to);
            setPage(1);
          },
          label: 'Date Range',
        }}
        agent={{
          value: actorId,
          onChange: (v) => {
            setActorId(v);
            setPage(1);
          },
          allUsers: true,
          label: 'User',
          placeholder: 'All Users',
        }}
        extraSelects={[
          {
            label: 'Action',
            value: action,
            onChange: (v) => {
              setAction(v);
              setPage(1);
            },
            options: ACTION_OPTIONS,
          },
        ]}
        onClear={() => {
          setAction('');
          setActorId('');
          setDateFrom('');
          setDateTo('');
          setPage(1);
        }}
        hasActiveFilters={hasActiveFilters}
      />

      <DataTable
        columns={columns}
        data={logs}
        totalCount={totalCount}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s);
          setPage(1);
        }}
        isLoading={loading}
      />

      <ChangesDialog log={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function ChangesDialog({ log, onClose }: { log: AuditLog | null; onClose: () => void }) {
  const entries = log ? Object.entries(log.changes || {}) : [];
  return (
    <Dialog open={!!log} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {log
              ? `${log.action_display} · ${log.object_label || titleCase(log.model_label)}`
              : 'Changes'}
          </DialogTitle>
        </DialogHeader>
        {log && (
          <div className="space-y-3">
            <div className="text-sm text-[#71717A]">
              {log.actor_name}
              {log.actor_email ? ` (${log.actor_email})` : ''} · {formatDateTime(log.timestamp)}
            </div>
            <div className="border border-[#E4E4E4] rounded-lg overflow-auto max-h-[60vh]">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-[#F3F3F3] h-10 text-left text-[#71717A]">
                    <th className="px-4 font-medium">Field</th>
                    <th className="px-4 font-medium">From</th>
                    <th className="px-4 font-medium">To</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-4 h-12 text-center text-[#71717A]">
                        No field changes
                      </td>
                    </tr>
                  ) : (
                    entries.map(([field, change]) => (
                      <tr key={field} className="border-t border-[#EDEDED] align-top">
                        <td className="px-4 py-2 font-medium text-[#303030] whitespace-nowrap">
                          {titleCase(field)}
                        </td>
                        <td className="px-4 py-2 text-[#71717A] break-words">
                          {formatValue(change.old)}
                        </td>
                        <td className="px-4 py-2 text-[#303030] break-words">
                          {formatValue(change.new)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
