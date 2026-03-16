'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DataTable } from '@/app/components/DataTable';
import { API_BASE_URL, getUsersForFilter } from '@/app/lib/api';
import { useAuth } from '@/app/context/AuthContext';
import { Plus } from 'lucide-react';
import { DateRangeFilter } from '@/components/ui/date-range-filter';
import { FormDatePicker } from '@/components/ui/form-date-picker';
import { formatDate, formatDateTime } from '@/app/lib/date';

interface MedicalClaimEntry {
  id: number;
  date: string;
  customer_name: string;
  status: string;
  added_by: number;
  added_by_name: string;
  added_at: string;
  is_editable: boolean;
}

interface FilterUser {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
}

const STATUS_OPTIONS = [
  { value: 'claims_opened', label: 'Claims Opened' },
  { value: 'claims_pending', label: 'Claims Pending' },
  { value: 'claims_resolved', label: 'Claims Resolved' },
];

const getStatusLabel = (value: string) => {
  const option = STATUS_OPTIONS.find((o) => o.value === value);
  return option ? option.label : value;
};

const columns = [
  { key: 'date', header: 'Date', render: (item: MedicalClaimEntry) => formatDate(item.date) },
  { key: 'added_by_name', header: 'Added By' },
  { key: 'added_at', header: 'Added At', render: (item: MedicalClaimEntry) => formatDateTime(item.added_at) },
  { key: 'customer_name', header: 'Customer Name' },
  { key: 'status', header: 'Status', render: (item: MedicalClaimEntry) => getStatusLabel(item.status) },
];

export default function MedicalClaimPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { canSeeAllData } = useAuth();
  const [entries, setEntries] = useState<MedicalClaimEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<MedicalClaimEntry | null>(null);
  const [error, setError] = useState('');
  const [users, setUsers] = useState<FilterUser[]>([]);

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
      const response = await fetch(`${API_BASE_URL}/api/entries/medical-claim/?${params}`, { credentials: 'include' });
      const data = await response.json();
      setEntries(data.results || []);
      setTotalCount(data.count || 0);
    } catch (err) { console.error('Failed to fetch entries:', err); }
    setIsLoading(false);
  };

  useEffect(() => { fetchUsers(); }, []);
  useEffect(() => { fetchEntries(); }, [page, pageSize, dateFrom, dateTo, userId]);

  const handleSave = async (formData: Partial<MedicalClaimEntry>) => {
    setError('');
    const url = editingEntry ? `${API_BASE_URL}/api/entries/medical-claim/${editingEntry.id}/` : `${API_BASE_URL}/api/entries/medical-claim/`;
    const response = await fetch(url, { method: editingEntry ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(formData) });
    if (response.ok) { setIsModalOpen(false); setEditingEntry(null); fetchEntries(); }
    else { const data = await response.json(); setError(data.error || 'Failed to save entry'); }
  };

  const handleDelete = async (entry: MedicalClaimEntry) => {
    if (!confirm('Are you sure you want to delete this entry?')) return;
    const response = await fetch(`${API_BASE_URL}/api/entries/medical-claim/${entry.id}/`, { method: 'DELETE', credentials: 'include' });
    if (response.ok) fetchEntries();
    else { const data = await response.json(); alert(data.error || 'Failed to delete entry'); }
  };

  const hasActiveFilters = dateFrom || dateTo || userId;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">Medical Claim</h1><p className="text-muted-foreground">Manage medical claims</p></div>
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
                  <SelectItem key={user.id} value={user.id.toString()}>{user.first_name} {user.last_name || user.email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {hasActiveFilters && <Button variant="outline" onClick={() => updateFilters({ dateFrom: '', dateTo: '', userId: '', page: 1 })}>Clear Filters</Button>}
      </div>
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

function EntryForm({ entry, onSave, onClose, error }: { entry: MedicalClaimEntry | null; onSave: (data: Partial<MedicalClaimEntry>) => void; onClose: () => void; error: string }) {
  const [formData, setFormData] = useState({ date: '', customer_name: '', status: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  useEffect(() => {
    if (entry) setFormData({ date: entry.date, customer_name: entry.customer_name, status: entry.status });
    else setFormData({ date: new Date().toISOString().split('T')[0], customer_name: '', status: '' });
  }, [entry]);
  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); setIsSubmitting(true); onSave({ date: formData.date, customer_name: formData.customer_name, status: formData.status }); setIsSubmitting(false); };
  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4">
      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md text-sm">{error}</div>}
      <FormDatePicker label="Date" value={formData.date} onChange={(date) => setFormData({ ...formData, date })} required />
      <div className="grid grid-cols-1 gap-4">
        <div className="space-y-2"><Label>Customer Name</Label><Input type="text" placeholder="Enter customer name" value={formData.customer_name} onChange={(e) => setFormData({ ...formData, customer_name: e.target.value })} required /></div>
        <div className="space-y-2">
          <Label>Status</Label>
          <Select value={formData.status} onValueChange={(value) => setFormData({ ...formData, status: value })}>
            <SelectTrigger className="shadow-none"><SelectValue placeholder="Select status" /></SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Saving...' : entry ? 'Update' : 'Create'}</Button></DialogFooter>
    </form>
  );
}
