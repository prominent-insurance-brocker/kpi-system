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

interface SalesKPIEntry {
  id: number;
  date: string;
  leads_to_ops_team: number;
  quotes_from_ops_team: number;
  quotes_to_client: number;
  total_conversions: number;
  existing_clients: number;
  existing_clients_closed: number;
  new_clients_acquired: number;
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
  { key: 'date', header: 'Date', render: (item: SalesKPIEntry) => formatDate(item.date) },
  { key: 'leads_to_ops_team', header: 'Leads to Ops Team', tooltip: 'Number of leads handed over to the operations team' },
  { key: 'quotes_from_ops_team', header: 'Quotes From Ops Team', tooltip: 'Number of quotes received from the operations team' },
  { key: 'quotes_to_client', header: 'Quotes to Client', tooltip: 'Number of quotes submitted to the client' },
  { key: 'total_conversions', header: 'Total Conversions', tooltip: 'Total number of conversions' },
  { key: 'existing_clients', header: 'Existing Clients', tooltip: 'Number of existing clients under my account' },
  { key: 'existing_clients_closed', header: 'Existing Clients Closed', tooltip: 'How many existing clients did I close' },
  { key: 'new_clients_acquired', header: 'New Clients Acquired', tooltip: 'Number of new clients acquired' },
  { key: 'added_by_name', header: 'Added By' },
  {
    key: 'added_at',
    header: 'Added At',
    render: (item: SalesKPIEntry) => formatDateTime(item.added_at),
  },
];

export default function SalesKPIPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { canSeeAllData } = useAuth();

  const [entries, setEntries] = useState<SalesKPIEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<SalesKPIEntry | null>(null);
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

      const response = await fetch(`${API_BASE_URL}/api/entries/sales-kpi/?${params}`, {
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

  const handleSave = async (formData: Partial<SalesKPIEntry>) => {
    setError('');
    const url = editingEntry
      ? `${API_BASE_URL}/api/entries/sales-kpi/${editingEntry.id}/`
      : `${API_BASE_URL}/api/entries/sales-kpi/`;

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

  const handleDelete = async (entry: SalesKPIEntry) => {
    if (!confirm('Are you sure you want to delete this entry?')) return;

    const response = await fetch(`${API_BASE_URL}/api/entries/sales-kpi/${entry.id}/`, {
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
          <h1 className="text-2xl font-bold">Sales KPI</h1>
          <p className="text-muted-foreground">Manage sales KPI entries</p>
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
                    {user.first_name} {user.last_name || user.email}
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
  onSave: (data: Partial<SalesKPIEntry>) => void;
  entry: SalesKPIEntry | null;
  error: string;
}) {
  const [formData, setFormData] = useState({
    date: '',
    leads_to_ops_team: '',
    quotes_from_ops_team: '',
    quotes_to_client: '',
    total_conversions: '',
    existing_clients: '',
    existing_clients_closed: '',
    new_clients_acquired: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (entry) {
      setFormData({
        date: entry.date,
        leads_to_ops_team: String(entry.leads_to_ops_team),
        quotes_from_ops_team: String(entry.quotes_from_ops_team),
        quotes_to_client: String(entry.quotes_to_client),
        total_conversions: String(entry.total_conversions),
        existing_clients: String(entry.existing_clients),
        existing_clients_closed: String(entry.existing_clients_closed),
        new_clients_acquired: String(entry.new_clients_acquired),
      });
    } else {
      setFormData({
        date: new Date().toISOString().split('T')[0],
        leads_to_ops_team: '',
        quotes_from_ops_team: '',
        quotes_to_client: '',
        total_conversions: '',
        existing_clients: '',
        existing_clients_closed: '',
        new_clients_acquired: '',
      });
    }
  }, [entry, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    await onSave({
      date: formData.date,
      leads_to_ops_team: Number(formData.leads_to_ops_team),
      quotes_from_ops_team: Number(formData.quotes_from_ops_team),
      quotes_to_client: Number(formData.quotes_to_client),
      total_conversions: Number(formData.total_conversions),
      existing_clients: Number(formData.existing_clients),
      existing_clients_closed: Number(formData.existing_clients_closed),
      new_clients_acquired: Number(formData.new_clients_acquired),
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
          <div className="space-y-5">
            {/* Lead to Quote Ratio */}
            <div>
              <h3 className="text-base font-semibold text-[#343434] mb-3">Lead to Quote Ratio</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="flex items-center gap-1">
                    Leads to Ops Team
                    <Tooltip text="Number of leads handed over to the operations team">
                      <Info className="h-3 w-3 text-[#71717A] cursor-help" />
                    </Tooltip>
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    placeholder="Enter count"
                    value={formData.leads_to_ops_team}
                    onChange={(e) => setFormData({ ...formData, leads_to_ops_team: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-1">
                    Quotes From Ops Team
                    <Tooltip text="Number of quotes received from the operations team">
                      <Info className="h-3 w-3 text-[#71717A] cursor-help" />
                    </Tooltip>
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    placeholder="Enter count"
                    value={formData.quotes_from_ops_team}
                    onChange={(e) => setFormData({ ...formData, quotes_from_ops_team: e.target.value })}
                    required
                  />
                </div>
              </div>
            </div>

            {/* Quote to Conversion Ratio */}
            <div>
              <h3 className="text-base font-semibold text-[#343434] mb-3">Quote to Conversion Ratio</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="flex items-center gap-1">
                    Quotes to Client
                    <Tooltip text="Number of quotes submitted to the client">
                      <Info className="h-3 w-3 text-[#71717A] cursor-help" />
                    </Tooltip>
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    placeholder="Enter count"
                    value={formData.quotes_to_client}
                    onChange={(e) => setFormData({ ...formData, quotes_to_client: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-1">
                    Total Conversions
                    <Tooltip text="Total number of conversions">
                      <Info className="h-3 w-3 text-[#71717A] cursor-help" />
                    </Tooltip>
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    placeholder="Enter count"
                    value={formData.total_conversions}
                    onChange={(e) => setFormData({ ...formData, total_conversions: e.target.value })}
                    required
                  />
                </div>
              </div>
            </div>

            {/* Client Retention Rate */}
            <div>
              <h3 className="text-base font-semibold text-[#343434] mb-3">Client Retention Rate</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="flex items-center gap-1">
                    Existing Clients
                    <Tooltip text="Number of existing clients under my account">
                      <Info className="h-3 w-3 text-[#71717A] cursor-help" />
                    </Tooltip>
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    placeholder="Enter count"
                    value={formData.existing_clients}
                    onChange={(e) => setFormData({ ...formData, existing_clients: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-1">
                    Existing Clients Closed
                    <Tooltip text="How many existing clients did I close">
                      <Info className="h-3 w-3 text-[#71717A] cursor-help" />
                    </Tooltip>
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    placeholder="Enter count"
                    value={formData.existing_clients_closed}
                    onChange={(e) => setFormData({ ...formData, existing_clients_closed: e.target.value })}
                    required
                  />
                </div>
              </div>
            </div>

            {/* New Clients Acquired */}
            <div>
              <h3 className="text-base font-semibold text-[#343434] mb-3">New Clients Acquired</h3>
              <div className="space-y-2">
                <Input
                  type="number"
                  min="0"
                  placeholder="Enter count"
                  value={formData.new_clients_acquired}
                  onChange={(e) => setFormData({ ...formData, new_clients_acquired: e.target.value })}
                  required
                />
              </div>
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
