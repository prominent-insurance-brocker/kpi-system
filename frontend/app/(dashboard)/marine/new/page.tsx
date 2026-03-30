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
import { DataTable, Tooltip } from '@/app/components/DataTable';
import { fetchApi, getUsersForFilter } from '@/app/lib/api';
import { useAuth } from '@/app/context/AuthContext';
import { Plus, Info } from 'lucide-react';
import { DateRangeFilter } from '@/components/ui/date-range-filter';
import { FormDatePicker } from '@/components/ui/form-date-picker';
import { formatDate, formatDateTime } from '@/app/lib/date';

interface MarineNewEntry {
  id: number;
  date: string;
  gross_booked_premium: number;
  quotes_created: number;
  new_clients_acquired: number;
  new_policies_issued: number;
  added_by: number;
  added_by_name: string;
  added_at: string;
  is_editable: boolean;
}

interface FilterUser {
  id: number;
  email: string;
  full_name: string;
}

const columns = [
  { key: 'date', header: 'Date', render: (item: MarineNewEntry) => formatDate(item.date) },
  { key: 'gross_booked_premium', header: 'Gross Booked Premium' },
  { key: 'quotes_created', header: 'Quotes Created', tooltip: 'Number of quotes created' },
  { key: 'new_clients_acquired', header: 'New Clients Acquired', tooltip: 'Number of new clients acquired' },
  { key: 'new_policies_issued', header: 'New Policies Issued', tooltip: 'Number of new policies issued' },
  { key: 'added_by_name', header: 'Added By' },
  {
    key: 'added_at',
    header: 'Added At',
    render: (item: MarineNewEntry) => formatDateTime(item.added_at),
  },
];

export default function MarineNewPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { canSeeAllData } = useAuth();

  const [entries, setEntries] = useState<MarineNewEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<MarineNewEntry | null>(null);
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

      const result = await fetchApi<{ results: MarineNewEntry[]; count: number }>(`/api/entries/marine-new/?${params}`);
      setEntries(result.data?.results || []);
      setTotalCount(result.data?.count || 0);
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

  const handleSave = async (formData: Partial<MarineNewEntry>) => {
    setError('');
    const endpoint = editingEntry
      ? `/api/entries/marine-new/${editingEntry.id}/`
      : `/api/entries/marine-new/`;

    const result = await fetchApi<MarineNewEntry>(endpoint, {
      method: editingEntry ? 'PATCH' : 'POST',
      body: JSON.stringify(formData),
    });

    if (result.data) {
      setIsModalOpen(false);
      setEditingEntry(null);
      fetchEntries();
    } else {
      setError(result.error || 'Failed to save entry');
    }
  };

  const handleDelete = async (entry: MarineNewEntry) => {
    if (!confirm('Are you sure you want to delete this entry?')) return;

    const result = await fetchApi<void>(`/api/entries/marine-new/${entry.id}/`, {
      method: 'DELETE',
    });

    if (!result.error) {
      fetchEntries();
    } else {
      alert(result.error || 'Failed to delete entry');
    }
  };

  const hasActiveFilters = dateFrom || dateTo || userId;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Marine New</h1>
          <p className="text-muted-foreground">Manage marine new business entries</p>
        </div>
        <Button
          onClick={() => {
            setEditingEntry(null);
            setError('');
            setIsModalOpen(true);
          }}
        >
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
                    {user.full_name || user.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {hasActiveFilters && (
          <Button
            variant="outline"
            onClick={() => updateFilters({ dateFrom: '', dateTo: '', userId: '', page: 1 })}
          >
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
        onEdit={(entry) => {
          setEditingEntry(entry);
          setError('');
          setIsModalOpen(true);
        }}
        onDelete={handleDelete}
        canEdit={(entry) => entry.is_editable}
        isLoading={isLoading}
      />

      <EntryModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingEntry(null);
          setError('');
        }}
        onSave={handleSave}
        entry={editingEntry}
        error={error}
      />
    </div>
  );
}

function EntryModal({
  isOpen,
  onClose,
  onSave,
  entry,
  error,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: Partial<MarineNewEntry>) => void;
  entry: MarineNewEntry | null;
  error: string;
}) {
  const [formData, setFormData] = useState({
    date: '',
    gross_booked_premium: '',
    quotes_created: '',
    new_clients_acquired: '',
    new_policies_issued: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (entry) {
      setFormData({
        date: entry.date,
        gross_booked_premium: String(entry.gross_booked_premium),
        quotes_created: String(entry.quotes_created),
        new_clients_acquired: String(entry.new_clients_acquired),
        new_policies_issued: String(entry.new_policies_issued),
      });
    } else {
      setFormData({
        date: new Date().toISOString().split('T')[0],
        gross_booked_premium: '',
        quotes_created: '',
        new_clients_acquired: '',
        new_policies_issued: '',
      });
    }
  }, [entry, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    await onSave({
      date: formData.date,
      gross_booked_premium: Number(formData.gross_booked_premium),
      quotes_created: Number(formData.quotes_created),
      new_clients_acquired: Number(formData.new_clients_acquired),
      new_policies_issued: Number(formData.new_policies_issued),
    });
    setIsSubmitting(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className='p-0'>
        <DialogHeader className='border-b border-[#E4E4E4] p-4'>
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
          <div className="grid grid-cols-1 gap-4">
            <div className="space-y-2">
              <Label>Gross Booked Premium</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="Enter gross booked premium"
                value={formData.gross_booked_premium}
                onChange={(e) => setFormData({ ...formData, gross_booked_premium: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1">
                Quotes Created
                <Tooltip text="Number of quotes created">
                  <Info className="h-3 w-3 text-[#71717A] cursor-help" />
                </Tooltip>
              </Label>
              <Input
                type="number"
                min="0"
                step="1"
                placeholder="Enter number of quotes created"
                value={formData.quotes_created}
                onChange={(e) => setFormData({ ...formData, quotes_created: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1">
                New Clients Acquired
                <Tooltip text="Number of new clients acquired">
                  <Info className="h-3 w-3 text-[#71717A] cursor-help" />
                </Tooltip>
              </Label>
              <Input
                type="number"
                min="0"
                step="1"
                placeholder="Enter number of new clients acquired"
                value={formData.new_clients_acquired}
                onChange={(e) => setFormData({ ...formData, new_clients_acquired: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1">
                New Policies Issued
                <Tooltip text="Number of new policies issued">
                  <Info className="h-3 w-3 text-[#71717A] cursor-help" />
                </Tooltip>
              </Label>
              <Input
                type="number"
                min="0"
                step="1"
                placeholder="Enter number of new policies issued"
                value={formData.new_policies_issued}
                onChange={(e) => setFormData({ ...formData, new_policies_issued: e.target.value })}
                required
              />
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
