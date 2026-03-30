'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DataTable } from '@/app/components/DataTable';
import { fetchApi, getUsersForFilter } from '@/app/lib/api';
import { useAuth } from '@/app/context/AuthContext';
import { Plus } from 'lucide-react';
import { DateRangeFilter } from '@/components/ui/date-range-filter';
import { FormDatePicker } from '@/components/ui/form-date-picker';
import { formatDate, formatDateTime } from '@/app/lib/date';
import { toast } from 'sonner';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

interface MotorClaimEntry {
  id: number;
  date: string;
  customer_name: string;
  status: string;
  added_by: number;
  added_by_name: string;
  added_at: string;
  is_editable: boolean;
  tat_display: string;
  allowed_transitions: string[];
  is_terminal: boolean;
}

interface FilterUser {
  id: number;
  email: string;
  full_name: string;
}

interface MotorClaimStats {
  claims_opened: number;
  claims_pending: number;
  claims_resolved: number;
  claims_rejected: number;
}

const STATUS_OPTIONS = [
  { value: 'claims_opened', label: 'Claims Opened' },
  { value: 'claims_pending', label: 'Claims Pending' },
  { value: 'claims_resolved', label: 'Claims Resolved' },
  { value: 'claims_rejected', label: 'Claims Rejected' },
];

const getStatusLabel = (value: string) => {
  const option = STATUS_OPTIONS.find((o) => o.value === value);
  return option ? option.label : value;
};

const STATUS_COLORS: Record<string, string> = {
  claims_opened: 'bg-blue-100 text-blue-800',
  claims_pending: 'bg-yellow-100 text-yellow-800',
  claims_resolved: 'bg-green-100 text-green-800',
  claims_rejected: 'bg-red-100 text-red-800',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[status] || ''}`}>
      {getStatusLabel(status)}
    </span>
  );
}

function InlineStatusSelect({
  currentStatus,
  allowedTransitions,
  onStatusChange,
}: {
  currentStatus: string;
  allowedTransitions: string[];
  onStatusChange: (status: string) => void;
}) {
  return (
    <Select value={currentStatus} onValueChange={onStatusChange}>
      <SelectTrigger className="h-8 w-[170px] text-xs shadow-none">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={currentStatus} disabled>
          {getStatusLabel(currentStatus)}
        </SelectItem>
        {allowedTransitions.map((s) => (
          <SelectItem key={s} value={s}>
            {getStatusLabel(s)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function MotorClaimPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { canSeeAllData } = useAuth();
  const [entries, setEntries] = useState<MotorClaimEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<MotorClaimEntry | null>(null);
  const [error, setError] = useState('');
  const [users, setUsers] = useState<FilterUser[]>([]);
  const [stats, setStats] = useState<MotorClaimStats | null>(null);

  const page = Number(searchParams.get('page')) || 1;
  const pageSize = Number(searchParams.get('pageSize')) || 20;
  const dateFrom = searchParams.get('dateFrom') || '';
  const dateTo = searchParams.get('dateTo') || '';
  const userId = searchParams.get('userId') || '';

  const updateFilters = (updates: Record<string, string | number>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (value) params.set(key, String(value));
      else params.delete(key);
    });
    router.push(`?${params.toString()}`);
  };

  const fetchUsers = async () => {
    if (canSeeAllData()) {
      const result = await getUsersForFilter();
      if (result.data) setUsers(result.data);
    }
  };

  const fetchEntries = async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('page_size', String(pageSize));
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      if (userId) params.set('user_id', userId);
      const result = await fetchApi<{ results: MotorClaimEntry[]; count: number }>(`/api/entries/motor-claim/?${params}`);
      setEntries(result.data?.results || []);
      setTotalCount(result.data?.count || 0);
    } catch (err) { console.error('Failed to fetch entries:', err); }
    setIsLoading(false);
  };

  const fetchStats = async () => {
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      if (userId) params.set('user_id', userId);
      const result = await fetchApi<typeof stats>(`/api/entries/motor-claim/stats/?${params}`);
      if (result.data) {
        setStats(result.data);
      }
    } catch (err) { console.error('Failed to fetch stats:', err); }
  };

  useEffect(() => { fetchUsers(); }, []);
  useEffect(() => { fetchEntries(); fetchStats(); }, [page, pageSize, dateFrom, dateTo, userId]);

  const updateStatus = async (entryId: number, newStatus: string) => {
    try {
      const result = await fetchApi<MotorClaimEntry>(
        `/api/entries/motor-claim/${entryId}/update-status/`,
        {
          method: 'PATCH',
          body: JSON.stringify({ status: newStatus }),
        }
      );
      if (result.data) {
        fetchEntries();
        fetchStats();
        toast.success(`Status updated to ${getStatusLabel(newStatus)}`);
      } else {
        alert(result.error || 'Failed to update status');
      }
    } catch (err) {
      console.error('Failed to update status:', err);
      alert('Failed to update status');
    }
  };

  const handleSave = async (formData: Partial<MotorClaimEntry>) => {
    setError('');
    const endpoint = editingEntry ? `/api/entries/motor-claim/${editingEntry.id}/` : `/api/entries/motor-claim/`;
    const result = await fetchApi<MotorClaimEntry>(endpoint, { method: editingEntry ? 'PATCH' : 'POST', body: JSON.stringify(formData) });
    if (result.data) { setIsModalOpen(false); setEditingEntry(null); fetchEntries(); fetchStats(); }
    else { setError(result.error || 'Failed to save entry'); }
  };

  const handleDelete = async (entry: MotorClaimEntry) => {
    if (!confirm('Are you sure you want to delete this entry?')) return;
    const result = await fetchApi<void>(`/api/entries/motor-claim/${entry.id}/`, { method: 'DELETE' });
    if (!result.error) { fetchEntries(); fetchStats(); }
    else { alert(result.error || 'Failed to delete entry'); }
  };

  const columns = [
    { key: 'date', header: 'Date', render: (item: MotorClaimEntry) => formatDate(item.date) },
    { key: 'added_by_name', header: 'Added By' },
    { key: 'added_at', header: 'Added At', render: (item: MotorClaimEntry) => formatDateTime(item.added_at) },
    { key: 'customer_name', header: 'Customer Name' },
    {
      key: 'status',
      header: 'Status',
      render: (item: MotorClaimEntry) => {
        if (item.is_terminal || item.allowed_transitions.length === 0) {
          return <StatusBadge status={item.status} />;
        }
        return (
          <InlineStatusSelect
            currentStatus={item.status}
            allowedTransitions={item.allowed_transitions}
            onStatusChange={(newStatus) => updateStatus(item.id, newStatus)}
          />
        );
      },
    },
    { key: 'tat_display', header: 'TAT' },
  ];

  const hasActiveFilters = dateFrom || dateTo || userId;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">Motor Claim</h1><p className="text-muted-foreground">Manage motor claims</p></div>
        <Button onClick={() => { setEditingEntry(null); setError(''); setIsModalOpen(true); }}><Plus className="h-4 w-4 mr-2" /> Add Entry</Button>
      </div>
      <div className="flex gap-4 items-end flex-wrap">
        <div className="flex flex-col gap-2">
          <Label>Date Range</Label>
          <DateRangeFilter
            dateFrom={dateFrom}
            dateTo={dateTo}
            onChange={(from, to) => updateFilters({ dateFrom: from, dateTo: to, page: 1 })}
          />
          </div>
        {canSeeAllData() && (
          <div className="flex flex-col gap-2">
            <Label>User</Label>
            <Select value={userId || 'all'} onValueChange={(value) => updateFilters({ userId: value === 'all' ? '' : value, page: 1 })}>
              <SelectTrigger className="w-[200px] shadow-none"><SelectValue placeholder="All Users" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Users</SelectItem>
                {users.map((user) => (
                  <SelectItem key={user.id} value={user.id.toString()}>{user.full_name || user.email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {hasActiveFilters && <Button variant="outline" onClick={() => updateFilters({ dateFrom: '', dateTo: '', userId: '', page: 1 })}>Clear Filters</Button>}
      </div>
      {stats && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Claims Opened</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-700">{stats.claims_opened}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Claims Pending</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-600">{stats.claims_pending}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Claims Resolved</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-700">{stats.claims_resolved}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Claims Rejected</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-700">{stats.claims_rejected}</div>
            </CardContent>
          </Card>
        </div>
      )}
      <DataTable columns={columns} data={entries} totalCount={totalCount} page={page} pageSize={pageSize} onPageChange={(p) => updateFilters({ page: p })} onPageSizeChange={(s) => updateFilters({ pageSize: s, page: 1 })} onEdit={(entry) => { setEditingEntry(entry); setError(''); setIsModalOpen(true); }} onDelete={handleDelete} canEdit={(entry) => entry.is_editable} isLoading={isLoading} />
      <Dialog open={isModalOpen} onOpenChange={() => { setIsModalOpen(false); setEditingEntry(null); setError(''); }}>
        <DialogContent className='p-0'>
          <DialogHeader className='border-b border-[#E4E4E4] p-4'><DialogTitle>{editingEntry ? 'Edit Entry' : 'Add New Entry'}</DialogTitle></DialogHeader>
          <EntryForm entry={editingEntry} onSave={handleSave} onClose={() => setIsModalOpen(false)} error={error} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EntryForm({ entry, onSave, onClose, error }: { entry: MotorClaimEntry | null; onSave: (data: Partial<MotorClaimEntry>) => void; onClose: () => void; error: string }) {
  const [formData, setFormData] = useState({ date: '', customer_name: '', status: 'claims_opened' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  useEffect(() => {
    if (entry) setFormData({ date: entry.date, customer_name: entry.customer_name, status: entry.status });
    else setFormData({ date: new Date().toISOString().split('T')[0], customer_name: '', status: 'claims_opened' });
  }, [entry]);

  const isEditing = !!entry;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    if (isEditing) {
      onSave({ date: formData.date, customer_name: formData.customer_name });
    } else {
      onSave({ date: formData.date, customer_name: formData.customer_name, status: formData.status });
    }
    setIsSubmitting(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4">
      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md text-sm">{error}</div>}
      <FormDatePicker label="Date" value={formData.date} onChange={(date) => setFormData({ ...formData, date })} required />
      <div className="grid grid-cols-1 gap-4">
        <div className="space-y-2"><Label>Customer Name</Label><Input type="text" placeholder="Enter customer name" value={formData.customer_name} onChange={(e) => setFormData({ ...formData, customer_name: e.target.value })} required /></div>
        {!isEditing && (
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value="claims_opened" disabled>
              <SelectTrigger className="shadow-none"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="claims_opened">Claims Opened</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Saving...' : entry ? 'Update' : 'Create'}</Button></DialogFooter>
    </form>
  );
}
