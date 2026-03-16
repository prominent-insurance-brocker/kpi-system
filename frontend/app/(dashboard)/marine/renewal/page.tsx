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
import { API_BASE_URL, getUsersForFilter } from '@/app/lib/api';
import { useAuth } from '@/app/context/AuthContext';
import { Plus, Info } from 'lucide-react';
import { DateRangeFilter } from '@/components/ui/date-range-filter';
import { FormDatePicker } from '@/components/ui/form-date-picker';
import { formatDate, formatDateTime } from '@/app/lib/date';

interface MarineRenewalEntry {
  id: number;
  date: string;
  monthly_renewal_quotes_assigned: number;
  gross_booked_premium: number;
  quotes_created: number;
  renewal_policies_issued: number;
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
  { key: 'date', header: 'Date', render: (item: MarineRenewalEntry) => formatDate(item.date) },
  { key: 'monthly_renewal_quotes_assigned', header: 'Monthly Renewal Quotes Assigned' },
  { key: 'gross_booked_premium', header: 'Gross Booked Premium' },
  { key: 'quotes_created', header: 'Quotes Created', tooltip: 'Number of renewal quotes created' },
  { key: 'renewal_policies_issued', header: 'Renewal Policies Issued', tooltip: 'Number of renewal policies issued' },
  { key: 'added_by_name', header: 'Added By' },
  {
    key: 'added_at',
    header: 'Added At',
    render: (item: MarineRenewalEntry) => formatDateTime(item.added_at),
  },
];

export default function MarineRenewalPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { canSeeAllData } = useAuth();

  const [entries, setEntries] = useState<MarineRenewalEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<MarineRenewalEntry | null>(null);
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

      const response = await fetch(`${API_BASE_URL}/api/entries/marine-renewal/?${params}`, {
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

  const handleSave = async (formData: Partial<MarineRenewalEntry>) => {
    setError('');
    const url = editingEntry
      ? `${API_BASE_URL}/api/entries/marine-renewal/${editingEntry.id}/`
      : `${API_BASE_URL}/api/entries/marine-renewal/`;

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

  const handleDelete = async (entry: MarineRenewalEntry) => {
    if (!confirm('Are you sure you want to delete this entry?')) return;

    const response = await fetch(`${API_BASE_URL}/api/entries/marine-renewal/${entry.id}/`, {
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
          <h1 className="text-2xl font-bold">Marine Renewal</h1>
          <p className="text-muted-foreground">Manage marine renewal entries</p>
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
  onSave: (data: Partial<MarineRenewalEntry>) => void;
  entry: MarineRenewalEntry | null;
  error: string;
}) {
  const [formData, setFormData] = useState({
    date: '',
    monthly_renewal_quotes_assigned: '',
    gross_booked_premium: '',
    quotes_created: '',
    renewal_policies_issued: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (entry) {
      setFormData({
        date: entry.date,
        monthly_renewal_quotes_assigned: String(entry.monthly_renewal_quotes_assigned),
        gross_booked_premium: String(entry.gross_booked_premium),
        quotes_created: String(entry.quotes_created),
        renewal_policies_issued: String(entry.renewal_policies_issued),
      });
    } else {
      setFormData({
        date: new Date().toISOString().split('T')[0],
        monthly_renewal_quotes_assigned: '',
        gross_booked_premium: '',
        quotes_created: '',
        renewal_policies_issued: '',
      });
    }
  }, [entry, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    await onSave({
      date: formData.date,
      monthly_renewal_quotes_assigned: Number(formData.monthly_renewal_quotes_assigned),
      gross_booked_premium: Number(formData.gross_booked_premium),
      quotes_created: Number(formData.quotes_created),
      renewal_policies_issued: Number(formData.renewal_policies_issued),
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
              <Label>Monthly Renewal Quotes Assigned</Label>
              <Input
                type="number"
                min="0"
                step="1"
                placeholder="Enter monthly renewal quotes assigned"
                value={formData.monthly_renewal_quotes_assigned}
                onChange={(e) => setFormData({ ...formData, monthly_renewal_quotes_assigned: e.target.value })}
                required
              />
            </div>
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
                <Tooltip text="Number of renewal quotes created">
                  <Info className="h-3 w-3 text-[#71717A] cursor-help" />
                </Tooltip>
              </Label>
              <Input
                type="number"
                min="0"
                step="1"
                placeholder="Enter number of renewal quotes created"
                value={formData.quotes_created}
                onChange={(e) => setFormData({ ...formData, quotes_created: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1">
                Renewal Policies Issued
                <Tooltip text="Number of renewal policies issued">
                  <Info className="h-3 w-3 text-[#71717A] cursor-help" />
                </Tooltip>
              </Label>
              <Input
                type="number"
                min="0"
                step="1"
                placeholder="Enter number of renewal policies issued"
                value={formData.renewal_policies_issued}
                onChange={(e) => setFormData({ ...formData, renewal_policies_issued: e.target.value })}
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
