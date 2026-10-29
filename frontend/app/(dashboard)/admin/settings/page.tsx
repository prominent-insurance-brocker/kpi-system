'use client';

/**
 * Settings — admin-only page for managing lookup tables used elsewhere in
 * the app (Type of Accident + Insurance Company for Motor Claim), plus the
 * saved Client list (rename / category tags / active / delete).
 *
 * The active tab and the Clients tab's search, category and page live in the
 * URL so a refresh or shared link lands on the same view.
 *
 * Non-admin users are redirected away on mount.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Pencil,
  Plus,
  Check,
  X as XIcon,
  Search,
  Trash2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/app/context/AuthContext';
import { firstAccessibleRoute } from '@/app/lib/navigation';
import { useConfirm } from '@/app/components/ConfirmDialog';
import { clientErrorMessage, useClientCategories } from '@/app/components/ClientSelect';
import {
  getAccidentTypes,
  getInsuranceCompanies,
  getClassOfInsurance,
  getMarineClassOfInsurance,
  createAccidentType,
  createInsuranceCompany,
  createClassOfInsurance,
  createMarineClassOfInsurance,
  updateAccidentType,
  updateInsuranceCompany,
  updateClassOfInsurance,
  updateMarineClassOfInsurance,
  listClients,
  updateClient,
  deleteClient,
  type Client,
  type SettingsLookup,
  type ApiResponse,
} from '@/app/lib/api';

type LookupResource =
  | 'accident-types'
  | 'insurance-companies'
  | 'class-of-insurance'
  | 'marine-class-of-insurance';

interface LookupResourceConfig {
  list: (params?: { is_active?: boolean }) => Promise<ApiResponse<SettingsLookup[]>>;
  create: (name: string) => Promise<ApiResponse<SettingsLookup>>;
  update: (
    id: number,
    data: { name?: string; is_active?: boolean }
  ) => Promise<ApiResponse<SettingsLookup>>;
  singularLabel: string;
  pluralLabel: string;
}

const RESOURCES: Record<LookupResource, LookupResourceConfig> = {
  'accident-types': {
    list: getAccidentTypes,
    create: createAccidentType,
    update: updateAccidentType,
    singularLabel: 'Accident Type',
    pluralLabel: 'Type of Accident',
  },
  'insurance-companies': {
    list: getInsuranceCompanies,
    create: createInsuranceCompany,
    update: updateInsuranceCompany,
    singularLabel: 'Insurance Company',
    pluralLabel: 'Insurance Company',
  },
  'class-of-insurance': {
    list: getClassOfInsurance,
    create: createClassOfInsurance,
    update: updateClassOfInsurance,
    singularLabel: 'Class of Insurance',
    pluralLabel: 'Class of Insurance',
  },
  'marine-class-of-insurance': {
    list: getMarineClassOfInsurance,
    create: createMarineClassOfInsurance,
    update: updateMarineClassOfInsurance,
    singularLabel: 'Marine Class of Insurance',
    pluralLabel: 'Marine Class of Insurance',
  },
};

const CLIENTS_PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

export default function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isLoading, canSeeAllData } = useAuth();
  const activeTab = searchParams.get('tab') || 'accident-types';

  const setActiveTab = (tab: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tab);
    router.replace(`?${params.toString()}`);
  };

  // Gate non-admin users away from the page.
  useEffect(() => {
    if (isLoading) return;
    if (!user || !canSeeAllData()) {
      router.replace(firstAccessibleRoute(user) ?? '/login');
    }
  }, [isLoading, user, canSeeAllData, router]);

  if (isLoading || !user || !canSeeAllData()) {
    return null;
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">
          Manage the lookup lists used elsewhere in the app.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-[#F3F4F6] rounded-lg p-1 gap-0 w-fit">
          <TabsTrigger
            value="accident-types"
            className="rounded-md px-4 py-1.5 data-[state=active]:bg-white"
          >
            Type of Accident
          </TabsTrigger>
          <TabsTrigger
            value="insurance-companies"
            className="rounded-md px-4 py-1.5 data-[state=active]:bg-white"
          >
            Insurance Company
          </TabsTrigger>
          <TabsTrigger
            value="class-of-insurance"
            className="rounded-md px-4 py-1.5 data-[state=active]:bg-white"
          >
            Class of Insurance
          </TabsTrigger>
          <TabsTrigger
            value="marine-class-of-insurance"
            className="rounded-md px-4 py-1.5 data-[state=active]:bg-white"
          >
            Marine Class of Insurance
          </TabsTrigger>
          <TabsTrigger
            value="clients"
            className="rounded-md px-4 py-1.5 data-[state=active]:bg-white"
          >
            Clients
          </TabsTrigger>
        </TabsList>

        <TabsContent value="accident-types" className="mt-4">
          <LookupTab resource="accident-types" />
        </TabsContent>
        <TabsContent value="insurance-companies" className="mt-4">
          <LookupTab resource="insurance-companies" />
        </TabsContent>
        <TabsContent value="class-of-insurance" className="mt-4">
          <LookupTab resource="class-of-insurance" />
        </TabsContent>
        <TabsContent value="marine-class-of-insurance" className="mt-4">
          <LookupTab resource="marine-class-of-insurance" />
        </TabsContent>
        <TabsContent value="clients" className="mt-4">
          <ClientsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function LookupTab({ resource }: { resource: LookupResource }) {
  const config = RESOURCES[resource];
  const [rows, setRows] = useState<SettingsLookup[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState('');

  const reload = useCallback(async () => {
    setIsLoading(true);
    const result = await config.list();
    setRows(result.data ?? []);
    setIsLoading(false);
  }, [config]);

  useEffect(() => {
    reload();
  }, [reload]);

  const addRow = async () => {
    const cleaned = newName.trim();
    if (!cleaned) return;
    setIsSubmitting(true);
    const result = await config.create(cleaned);
    setIsSubmitting(false);
    if (result.data) {
      toast.success(`${config.singularLabel} added`);
      setIsAddOpen(false);
      setNewName('');
      reload();
    } else {
      toast.error(result.error || `Failed to add ${config.singularLabel.toLowerCase()}`);
    }
  };

  const saveEdit = async (id: number) => {
    const cleaned = editingValue.trim();
    if (!cleaned) return;
    const result = await config.update(id, { name: cleaned });
    if (result.data) {
      toast.success('Updated');
      setEditingId(null);
      reload();
    } else {
      toast.error(result.error || 'Failed to update');
    }
  };

  const toggleActive = async (row: SettingsLookup) => {
    const result = await config.update(row.id, { is_active: !row.is_active });
    if (result.data) {
      toast.success(row.is_active ? 'Deactivated' : 'Reactivated');
      reload();
    } else {
      toast.error(result.error || 'Failed to update');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{config.pluralLabel}</h2>
        <Button onClick={() => { setNewName(''); setIsAddOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" />
          Add {config.singularLabel}
        </Button>
      </div>

      {/* TED-515: overflow-auto + max-h gives users visible horizontal +
          vertical scrollbars when content overflows. Was overflow-hidden
          which silently clipped anything past the visible area. */}
      <div className="bg-white border border-[#E4E4E4] rounded-2xl overflow-auto max-h-[calc(100vh-270px)]">
        <table className="w-full min-w-max border-collapse">
          <thead>
            <tr className="bg-[#F3F3F3] h-11">
              <th className="px-5 text-left text-sm font-medium text-[#71717A]">Name</th>
              <th className="px-5 text-left text-sm font-medium text-[#71717A] w-32">Status</th>
              <th className="px-5 text-right text-sm font-medium text-[#71717A] w-48">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={3} className="h-16 text-center text-[#71717A]">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={3} className="h-16 text-center text-[#71717A]">
                  No {config.pluralLabel.toLowerCase()} configured yet.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const isEditing = editingId === row.id;
                return (
                  <tr
                    key={row.id}
                    className="h-14 border-t border-[#EDEDED]"
                  >
                    <td className="px-5">
                      {isEditing ? (
                        <Input
                          autoFocus
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              saveEdit(row.id);
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              setEditingId(null);
                            }
                          }}
                          className="max-w-sm"
                        />
                      ) : (
                        <span className={!row.is_active ? 'text-muted-foreground' : ''}>
                          {row.name}
                        </span>
                      )}
                    </td>
                    <td className="px-5">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          row.is_active
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {row.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-5 text-right">
                      <div className="inline-flex items-center gap-1">
                        {isEditing ? (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => setEditingId(null)}
                            >
                              <XIcon className="h-3 w-3 mr-1" /> Cancel
                            </Button>
                            <Button type="button" size="sm" onClick={() => saveEdit(row.id)}>
                              <Check className="h-3 w-3 mr-1" /> Save
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setEditingId(row.id);
                                setEditingValue(row.name);
                              }}
                            >
                              <Pencil className="h-3 w-3 mr-1" /> Edit
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => toggleActive(row)}
                            >
                              {row.is_active ? 'Deactivate' : 'Reactivate'}
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={isAddOpen} onOpenChange={(open) => { if (!open) setIsAddOpen(false); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add {config.singularLabel}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              addRow();
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label>Name *</Label>
              <Input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={`e.g. ${
                  resource === 'accident-types'
                    ? 'Hailstorm'
                    : resource === 'insurance-companies'
                      ? 'GoldStar Insurance'
                      : 'Marine Cargo Insurance'
                }`}
                required
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsAddOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting || !newName.trim()}>
                {isSubmitting ? 'Saving…' : 'Save'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Clients tab ─────────────────────────────────────────────────────────────

function ClientsTab() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const confirm = useConfirm();
  const categories = useClientCategories();
  const categoryLabel = (key: string) =>
    categories.find((c) => c.value === key)?.label ?? key;

  // URL-synced filters (prefixed so they don't clash with other tabs).
  const search = searchParams.get('client_search') || '';
  const category = searchParams.get('client_category') || '';
  const page = Math.max(1, Number(searchParams.get('client_page')) || 1);

  const updateParams = useCallback(
    (updates: Record<string, string | number>) => {
      const params = new URLSearchParams(searchParams.toString());
      Object.entries(updates).forEach(([key, value]) => {
        // Page 1 is the default, so it's left out of the URL.
        if (value && !(key === 'client_page' && value === 1)) {
          params.set(key, String(value));
        } else {
          params.delete(key);
        }
      });
      router.replace(`?${params.toString()}`);
    },
    [searchParams, router]
  );

  // Debounced search box -> URL (resets to page 1).
  const [searchInput, setSearchInput] = useState(search);
  useEffect(() => {
    if (searchInput.trim() === search) return;
    const t = setTimeout(
      () => updateParams({ client_search: searchInput.trim(), client_page: 1 }),
      SEARCH_DEBOUNCE_MS
    );
    return () => clearTimeout(t);
  }, [searchInput, search, updateParams]);

  const [rows, setRows] = useState<Client[]>([]);
  const [count, setCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  // Only the latest request may write state, so a slow response for an older
  // search / page / category can't overwrite the current one.
  const requestIdRef = useRef(0);

  const reload = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setLoadError('');
    const result = await listClients({
      search,
      category: category || undefined,
      page,
      page_size: CLIENTS_PAGE_SIZE,
      include_counts: true,
    });
    if (requestId !== requestIdRef.current) return;
    if (result.data) {
      setRows(result.data.results);
      setCount(result.data.count);
    } else if (page > 1) {
      // Out-of-range page (e.g. after a delete or a stale link): go to page 1.
      updateParams({ client_page: 1 });
    } else {
      setRows([]);
      setCount(0);
      setLoadError(result.error || 'Failed to load clients');
    }
    setIsLoading(false);
  }, [search, category, page, updateParams]);

  useEffect(() => {
    reload();
  }, [reload]);

  const totalPages = Math.max(1, Math.ceil(count / CLIENTS_PAGE_SIZE));

  // ── Edit dialog (rename + category tags) ──
  const [editing, setEditing] = useState<Client | null>(null);
  const [editName, setEditName] = useState('');
  const [editCategories, setEditCategories] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const openEdit = (row: Client) => {
    setEditing(row);
    setEditName(row.name);
    setEditCategories(row.categories);
  };

  const cleanedEditName = editName.trim().replace(/\s+/g, ' ');

  const saveEdit = async () => {
    if (!editing || !cleanedEditName || editCategories.length === 0) return;
    const data: { name?: string; categories?: string[] } = {};
    if (cleanedEditName !== editing.name) data.name = cleanedEditName;
    const sameCategories =
      editCategories.length === editing.categories.length &&
      editCategories.every((c) => editing.categories.includes(c));
    if (!sameCategories) data.categories = editCategories;
    if (!data.name && !data.categories) {
      setEditing(null);
      return;
    }
    const linked = editing.linked_entries_count ?? 0;
    if (data.name && linked > 0) {
      const ok = await confirm({
        title: 'Rename client?',
        description: `This will update ${linked} ${linked === 1 ? 'enquiry' : 'enquiries'}: "${editing.name}" becomes "${data.name}".`,
        confirmLabel: 'Rename',
      });
      if (!ok) return;
    }
    setIsSaving(true);
    const result = await updateClient(editing.id, data);
    setIsSaving(false);
    if (result.data) {
      toast.success('Client updated');
      setEditing(null);
      reload();
    } else {
      toast.error(clientErrorMessage(result, 'Failed to update client'));
    }
  };

  const toggleActive = async (row: Client) => {
    const result = await updateClient(row.id, { is_active: !row.is_active });
    if (result.data) {
      toast.success(row.is_active ? 'Deactivated' : 'Reactivated');
      reload();
    } else {
      toast.error(clientErrorMessage(result, 'Failed to update client'));
    }
  };

  const removeRow = async (row: Client) => {
    const ok = await confirm({
      title: 'Delete client?',
      description: `Delete "${row.name}" (${row.username})? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    const result = await deleteClient(row.id);
    if (!result.error) {
      toast.success('Client deleted');
      reload();
    } else {
      toast.error(clientErrorMessage(result, 'Failed to delete client'));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Clients</h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search name or username"
              className="h-9 w-64 pl-8"
            />
          </div>
          <Select
            value={category || 'all'}
            onValueChange={(v) =>
              updateParams({ client_category: v === 'all' ? '' : v, client_page: 1 })
            }
          >
            <SelectTrigger className="w-[180px] h-9 shadow-none">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="bg-white border border-[#E4E4E4] rounded-2xl overflow-auto max-h-[calc(100vh-320px)]">
        <table className="w-full min-w-max border-collapse">
          <thead>
            <tr className="bg-[#F3F3F3] h-11">
              <th className="px-5 text-left text-sm font-medium text-[#71717A]">Name</th>
              <th className="px-5 text-left text-sm font-medium text-[#71717A]">Username</th>
              <th className="px-5 text-left text-sm font-medium text-[#71717A]">Categories</th>
              <th className="px-5 text-left text-sm font-medium text-[#71717A] w-32">Status</th>
              <th className="px-5 text-right text-sm font-medium text-[#71717A] w-40">
                Linked Enquiries
              </th>
              <th className="px-5 text-right text-sm font-medium text-[#71717A] w-64">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={6} className="h-16 text-center text-[#71717A]">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="h-16 text-center text-[#71717A]">
                  {loadError || (search || category ? 'No clients match.' : 'No clients yet.')}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const linked = row.linked_entries_count ?? 0;
                return (
                  <tr key={row.id} className="h-14 border-t border-[#EDEDED]">
                    <td className="px-5">
                      <span className={!row.is_active ? 'text-muted-foreground' : ''}>
                        {row.name}
                      </span>
                    </td>
                    <td className="px-5 text-sm text-[#71717A]">{row.username}</td>
                    <td className="px-5">
                      <div className="flex flex-wrap gap-1">
                        {row.categories.map((c) => (
                          <span
                            key={c}
                            className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-800"
                          >
                            {categoryLabel(c)}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-5">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          row.is_active
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {row.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-5 text-right tabular-nums">{linked}</td>
                    <td className="px-5 text-right">
                      <div className="inline-flex items-center gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => openEdit(row)}
                        >
                          <Pencil className="h-3 w-3 mr-1" /> Edit
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => toggleActive(row)}
                        >
                          {row.is_active ? 'Deactivate' : 'Reactivate'}
                        </Button>
                        {/* Delete is only offered for clients no enquiry uses. */}
                        {linked === 0 && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => removeRow(row)}
                          >
                            <Trash2 className="h-3 w-3 mr-1" /> Delete
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-[#71717A]">
        <span>
          {count} {count === 1 ? 'client' : 'clients'}
        </span>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={page <= 1 || isLoading}
            onClick={() => updateParams({ client_page: page - 1 })}
          >
            <ChevronLeft className="h-4 w-4" /> Previous
          </Button>
          <span>
            Page {Math.min(page, totalPages)} of {totalPages}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={page >= totalPages || isLoading}
            onClick={() => updateParams({ client_page: page + 1 })}
          >
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Dialog open={!!editing} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Client</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveEdit();
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label>Name *</Label>
              <Input
                autoFocus
                value={editName}
                maxLength={200}
                onChange={(e) => setEditName(e.target.value)}
                required
              />
              {editing && (editing.linked_entries_count ?? 0) > 0 && (
                <p className="text-xs text-muted-foreground">
                  Renaming also updates the client name on {editing.linked_entries_count} linked{' '}
                  {editing.linked_entries_count === 1 ? 'enquiry' : 'enquiries'}.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Categories *</Label>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {categories.map((c) => (
                  <label key={c.value} className="inline-flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={editCategories.includes(c.value)}
                      onCheckedChange={(checked) =>
                        setEditCategories((prev) =>
                          checked === true
                            ? prev.includes(c.value)
                              ? prev
                              : [...prev, c.value]
                            : prev.filter((k) => k !== c.value)
                        )
                      }
                    />
                    {c.label}
                  </label>
                ))}
              </div>
              {editCategories.length === 0 && (
                <p className="text-xs text-red-600">Pick at least one category.</p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSaving || !cleanedEditName || editCategories.length === 0}
              >
                {isSaving ? 'Saving…' : 'Save'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
