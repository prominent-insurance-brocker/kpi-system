'use client';

import { useState, useEffect } from 'react';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DataTable } from '@/app/components/DataTable';
import { API_BASE_URL, getUsersForFilter } from '@/app/lib/api';
import { useAuth } from '@/app/context/AuthContext';
import { Plus } from 'lucide-react';
import { DateRangeFilter } from '@/components/ui/date-range-filter';
import { FormDatePicker } from '@/components/ui/form-date-picker';

interface GeneralRenewalEntry {
  id: number;
  date: string;
  quotations: number;
  quotes_revised: number;
  quotes_converted: number;
  tat: number;
  accuracy: number;
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

const columns = [
  { key: 'date', header: 'Date' },
  { key: 'quotations', header: 'Quotations' },
  { key: 'quotes_revised', header: 'Quotes Revised' },
  { key: 'quotes_converted', header: 'Quotes Converted' },
  { key: 'tat', header: 'TAT' },
  {
    key: 'accuracy',
    header: 'Accuracy',
    render: (item: GeneralRenewalEntry) => `${item.accuracy}%`,
  },
  { key: 'added_by_name', header: 'Added By' },
  {
    key: 'added_at',
    header: 'Added At',
    render: (item: GeneralRenewalEntry) => new Date(item.added_at).toLocaleString(),
  },
];

export default function GeneralRenewalPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { canSeeAllData } = useAuth();

  const [entries, setEntries] = useState<GeneralRenewalEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<GeneralRenewalEntry | null>(null);
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
      if (value) {
        params.set(key, String(value));
      } else {
        params.delete(key);
      }
    });
    router.push(`?${params.toString()}`);
  };

  const fetchUsers = async () => {
    if (canSeeAllData()) {
      const result = await getUsersForFilter();
      if (result.data) {
        setUsers(result.data);
      }
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

      const response = await fetch(`${API_BASE_URL}/api/entries/general-renewal/?${params}`, {
        credentials: 'include',
      });
      const data = await response.json();
      setEntries(data.results || []);
      setTotalCount(data.count || 0);
    } catch (err) {
      console.error('Failed to fetch entries:', err);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  useEffect(() => {
    fetchEntries();
  }, [page, pageSize, dateFrom, dateTo, userId]);

  const handleSave = async (formData: Partial<GeneralRenewalEntry>) => {
    setError('');
    const url = editingEntry
      ? `${API_BASE_URL}/api/entries/general-renewal/${editingEntry.id}/`
      : `${API_BASE_URL}/api/entries/general-renewal/`;

    const response = await fetch(url, {
      method: editingEntry ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(formData),
    });

    if (response.ok) {
      setIsModalOpen(false);
      setEditingEntry(null);
      fetchEntries();
    } else {
      const data = await response.json();
      setError(data.error || 'Failed to save entry');
    }
  };

  const handleDelete = async (entry: GeneralRenewalEntry) => {
    if (!confirm('Are you sure you want to delete this entry?')) return;

    const response = await fetch(`${API_BASE_URL}/api/entries/general-renewal/${entry.id}/`, {
      method: 'DELETE',
      credentials: 'include',
    });

    if (response.ok) {
      fetchEntries();
    } else {
      const data = await response.json();
      alert(data.error || 'Failed to delete entry');
    }
  };

  const hasActiveFilters = dateFrom || dateTo || userId;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">General Renewal</h1>
          <p className="text-muted-foreground">Manage general renewal quotations</p>
        </div>
        <Button onClick={() => { setEditingEntry(null); setError(''); setIsModalOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" /> Add Entry
        </Button>
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
            <Select
              value={userId || 'all'}
              onValueChange={(value) => updateFilters({ userId: value === 'all' ? '' : value, page: 1 })}
            >
              <SelectTrigger className="w-[200px] shadow-none">
                <SelectValue placeholder="All Users" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Users</SelectItem>
                {users.map((user) => (
                  <SelectItem key={user.id} value={user.id.toString()}>
                    {user.first_name} {user.last_name || user.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {hasActiveFilters && (
          <Button variant="outline" onClick={() => updateFilters({ dateFrom: '', dateTo: '', userId: '', page: 1 })}>
            Clear Filters
          </Button>
        )}
      </div>

      <DataTable
        columns={columns}
        data={entries}
        totalCount={totalCount}
        page={page}
        pageSize={pageSize}
        onPageChange={(p) => updateFilters({ page: p })}
        onPageSizeChange={(s) => updateFilters({ pageSize: s, page: 1 })}
        onEdit={(entry) => { setEditingEntry(entry); setError(''); setIsModalOpen(true); }}
        onDelete={handleDelete}
        canEdit={(entry) => entry.is_editable}
        isLoading={isLoading}
      />

      <Dialog open={isModalOpen} onOpenChange={() => { setIsModalOpen(false); setEditingEntry(null); setError(''); }}>
        <DialogContent className='p-0'>
          <DialogHeader className='border-b border-[#E4E4E4] p-4'>
            <DialogTitle>{editingEntry ? 'Edit Entry' : 'Add New Entry'}</DialogTitle>
          </DialogHeader>
          <EntryForm entry={editingEntry} onSave={handleSave} onClose={() => setIsModalOpen(false)} error={error} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EntryForm({ entry, onSave, onClose, error }: { entry: GeneralRenewalEntry | null; onSave: (data: Partial<GeneralRenewalEntry>) => void; onClose: () => void; error: string }) {
  const [formData, setFormData] = useState({ date: '', quotations: 0, quotes_revised: 0, quotes_converted: 0, tat: 0, accuracy: 0 });
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (entry) {
      setFormData({ date: entry.date, quotations: entry.quotations, quotes_revised: entry.quotes_revised, quotes_converted: entry.quotes_converted, tat: entry.tat, accuracy: Number(entry.accuracy) });
    } else {
      setFormData({ date: new Date().toISOString().split('T')[0], quotations: 0, quotes_revised: 0, quotes_converted: 0, tat: 0, accuracy: 0 });
    }
  }, [entry]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    await onSave(formData);
    setIsSubmitting(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4">
      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md text-sm">{error}</div>}
      <FormDatePicker label="Date" value={formData.date} onChange={(date) => setFormData({ ...formData, date })} required />
      <div className="grid grid-cols-1 gap-4">
        <div className="space-y-2"><Label>Quotations</Label><Input type="number" min="0" value={formData.quotations} onChange={(e) => setFormData({ ...formData, quotations: Number(e.target.value) })} required /></div>
        <div className="space-y-2"><Label>Quotes Revised</Label><Input type="number" min="0" value={formData.quotes_revised} onChange={(e) => setFormData({ ...formData, quotes_revised: Number(e.target.value) })} required /></div>
        <div className="space-y-2"><Label>Quotes Converted</Label><Input type="number" min="0" value={formData.quotes_converted} onChange={(e) => setFormData({ ...formData, quotes_converted: Number(e.target.value) })} required /></div>
        <div className="space-y-2"><Label>TAT</Label><Input type="number" min="0" value={formData.tat} onChange={(e) => setFormData({ ...formData, tat: Number(e.target.value) })} required /></div>
        <div className="space-y-2"><Label>Accuracy (%)</Label><Input type="number" min="0" max="100" step="0.01" value={formData.accuracy} onChange={(e) => setFormData({ ...formData, accuracy: Number(e.target.value) })} required /></div>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Saving...' : entry ? 'Update' : 'Create'}</Button>
      </DialogFooter>
    </form>
  );
}
