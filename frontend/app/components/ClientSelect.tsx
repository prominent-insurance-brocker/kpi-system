'use client';

/**
 * Picker for the saved Client list, scoped to one parent category (e.g.
 * 'marine'). Wraps SearchableSelect: server-side search + infinite scroll over
 * GET /api/entries/clients/?category=…&is_active=true.
 *
 * Typing a name always offers a 'Create "<name>"' row (names may repeat). It
 * opens the "New client" dialog (ClientCreateDialog) pre-filled with the
 * typed name; the + button next to the picker opens it empty. The dialog has
 * the name, a live @username, categories (the module's own one ticked and
 * locked; others can be added), and optional notes. A same-name 409 lists the existing
 * matches to pick from, plus "Create new anyway" (resends with force=true).
 *
 * With a client selected, staff, Settings users and the client's creator
 * (non-HOD) get an "Edit client" button that opens ClientEditDialog (name,
 * categories, notes, active).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Pencil, Plus } from 'lucide-react';

import { SearchableSelect } from '@/components/ui/searchable-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { useAuth } from '@/app/context/AuthContext';
import { ClientCreateDialog } from '@/app/components/ClientCreateDialog';
import {
  listClients,
  getClient,
  suggestClientUsername,
  updateClient,
  getClientCategories,
  firstFieldError,
  CLIENT_NOTES_MAX_LENGTH,
  type Client,
  type ClientRef,
  type ClientCategoryOption,
  type ClientDuplicateError,
  type ApiResponse,
} from '@/app/lib/api';

const MAX_NAME_LENGTH = 200;

export function clientLabel(client: Pick<ClientRef, 'name' | 'username'>): string {
  return `${client.name} · ${client.username}`;
}

/** Best human message from a failed client API call. */
export function clientErrorMessage(res: ApiResponse<unknown>, fallback: string): string {
  return (
    firstFieldError(res, [
      'name',
      'categories',
      'notes',
      'is_active',
      'non_field_errors',
      'detail',
    ]) ||
    res.error ||
    fallback
  );
}

// The categories list never changes at runtime; share one request per page load.
let categoriesPromise: Promise<ClientCategoryOption[]> | null = null;
function loadCategories(): Promise<ClientCategoryOption[]> {
  if (!categoriesPromise) {
    categoriesPromise = getClientCategories().then((res) => {
      if (!res.data) categoriesPromise = null; // retry on the next mount
      return res.data ?? [];
    });
  }
  return categoriesPromise;
}

export function useClientCategories(): ClientCategoryOption[] {
  const [categories, setCategories] = useState<ClientCategoryOption[]>([]);
  useEffect(() => {
    let cancelled = false;
    loadCategories().then((rows) => {
      if (!cancelled) setCategories(rows);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return categories;
}

interface ClientSelectProps {
  // Parent category whose clients are listed (and pre-ticked on create).
  category: string;
  value: number | null;
  // Called with the picked client, or null if the value is cleared.
  onChange: (client: ClientRef | null) => void;
  // Trigger text for a value that hasn't been picked/loaded yet (Edit form).
  selectedLabel?: string | null;
  placeholder?: string;
  disabled?: boolean;
}

export function ClientSelect({
  category,
  value,
  onChange,
  selectedLabel,
  placeholder = 'Select client',
  disabled,
}: ClientSelectProps) {
  const categories = useClientCategories();
  const categoryLabel = categories.find((c) => c.value === category)?.label ?? category;

  // Every client seen in a loaded page, so onValueChange (which only gets the
  // id) can hand the full client (name included) back to the form. List rows
  // and created clients are full Client objects; duplicate matches are not.
  const seenRef = useRef(new Map<string, ClientRef | Client>());

  const fetchPage = useCallback(
    async ({ search, page }: { search: string; page: number }) => {
      const res = await listClients({
        category,
        search,
        page,
        is_active: true,
      });
      const rows = res.data?.results ?? [];
      for (const c of rows) seenRef.current.set(String(c.id), c);
      return { results: rows as ClientRef[], hasMore: !!res.data?.next };
    },
    [category]
  );

  // ── Selected client details (for the "Edit client" button) ──────────────
  const { user, hasModulePermission, isHOD } = useAuth();
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  // Bumped after an edit: remounts SearchableSelect so it drops its cached
  // picked label and shows the edited name (passed as selectedLabel).
  const [labelVersion, setLabelVersion] = useState(0);
  const [isEditOpen, setIsEditOpen] = useState(false);

  useEffect(() => {
    if (!value) return;
    const seen = seenRef.current.get(String(value));
    if (seen && 'created_by' in seen) {
      setSelectedClient(seen);
      return;
    }
    // Not loaded yet (Edit form, or a duplicate-match pick): fetch it.
    let cancelled = false;
    getClient(value).then((res) => {
      if (cancelled) return;
      if (res.data) seenRef.current.set(String(res.data.id), res.data);
      setSelectedClient(res.data ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [value]);

  // Only trust selectedClient while it matches the current value.
  const currentClient = selectedClient && selectedClient.id === value ? selectedClient : null;
  const isClientAdmin = !!user && (user.is_staff || hasModulePermission('settings'));
  const canEditSelected =
    !!user &&
    !!currentClient &&
    // The backend refuses every client create/edit from HOD users, even with
    // the Settings module, so HOD never gets the edit or create controls.
    !isHOD() &&
    (isClientAdmin || currentClient.created_by === user.id);

  const handleEdited = (updated: Client) => {
    seenRef.current.set(String(updated.id), updated);
    setLabelVersion((v) => v + 1);
    if (!updated.is_active || !updated.categories.includes(category)) {
      // No longer pickable here: clear the selection.
      setSelectedClient(null);
      onChange(null);
      toast.success(
        !updated.is_active
          ? 'Client updated and deactivated. Pick another client.'
          : `Client updated (no longer in the ${categoryLabel} list). Pick another client.`
      );
      return;
    }
    setSelectedClient(updated);
    onChange(updated);
    toast.success('Client updated');
  };

  // ── New client dialog (ClientCreateDialog) ─────────────────────────────
  // openCreateDialog returns a promise that settles when the dialog finishes:
  // with the client to select, or undefined on cancel / not usable here.
  const resolveRef = useRef<((client: ClientRef | undefined) => void) | null>(null);
  const [createDialog, setCreateDialog] = useState<{
    open: boolean;
    name: string;
    matches: ClientDuplicateError['matches'] | null;
    error: string;
  }>({ open: false, name: '', matches: null, error: '' });
  const isPanelOpen = createDialog.open;

  // Settle a pending create if the form unmounts with the dialog open.
  useEffect(() => () => resolveRef.current?.(undefined), []);

  const finishPanel = (client: ClientRef | undefined) => {
    setCreateDialog((d) => ({ ...d, open: false }));
    const resolve = resolveRef.current;
    resolveRef.current = null;
    resolve?.(client);
  };

  const openCreateDialog = (
    name: string,
    initial?: { matches?: ClientDuplicateError['matches'] | null; error?: string }
  ) => {
    resolveRef.current?.(undefined);
    setCreateDialog({
      open: true,
      name,
      matches: initial?.matches ?? null,
      error: initial?.error ?? '',
    });
    return new Promise<ClientRef | undefined>((resolve) => {
      resolveRef.current = resolve;
    });
  };

  // 'Create "<name>"' row in the dropdown: open the dialog pre-filled.
  const createFromSearch = (search: string) => openCreateDialog(search);

  // + button: explicit create in the dialog; select the result if it fits.
  const createFromButton = async () => {
    const created = await openCreateDialog('');
    if (!created) return;
    seenRef.current.set(String(created.id), created);
    setSelectedClient('created_by' in created ? (created as Client) : null);
    setLabelVersion((v) => v + 1);
    onChange(created);
  };

  const handleDialogCreated = (created: Client) => {
    seenRef.current.set(String(created.id), created);
    if (created.categories.includes(category)) {
      toast.success(`Client created: ${clientLabel(created)}`);
      finishPanel(created);
    } else {
      // Not tagged with this module's category, so it can't be used here.
      toast.success(`Client created (not in the ${categoryLabel} list)`);
      finishPanel(undefined);
    }
  };

  const pickMatch = (match: ClientRef) => {
    seenRef.current.set(String(match.id), match);
    finishPanel(match);
  };

  const canCreate = !isHOD();

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <SearchableSelect<ClientRef>
            key={labelVersion}
            value={value ? String(value) : null}
            onValueChange={(v) => {
              onChange(v ? (seenRef.current.get(v) ?? null) : null);
            }}
            fetchPage={fetchPage}
            getOptionValue={(c) => String(c.id)}
            getOptionLabel={(c) => c.name}
            getOptionSubtitle={(c) => c.username}
            getTriggerLabel={clientLabel}
            getCreateMatchText={(c) => c.name}
            placeholder={placeholder}
            emptyLabel="No clients found"
            selectedLabel={
              labelVersion > 0 && currentClient ? clientLabel(currentClient) : selectedLabel
            }
            disabled={disabled || isPanelOpen}
            onCreate={canCreate ? createFromSearch : undefined}
            createLabel={(search) => `Create "${search}"`}
            // Names may repeat: offer Create even when the name already exists
            // (the server then warns with the matches before creating).
            alwaysShowCreate
          />
        </div>
        {canCreate && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0"
            title="New client"
            aria-label="New client"
            disabled={disabled}
            onClick={createFromButton}
          >
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </div>

      {canEditSelected && !isPanelOpen && (
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            disabled={disabled}
            onClick={() => setIsEditOpen(true)}
          >
            <Pencil className="h-3 w-3 mr-1" /> Edit client
          </Button>
        </div>
      )}

      <ClientEditDialog
        client={isEditOpen ? currentClient : null}
        onClose={() => setIsEditOpen(false)}
        onSaved={(updated) => {
          setIsEditOpen(false);
          handleEdited(updated);
        }}
      />

      <ClientCreateDialog
        open={createDialog.open}
        initialName={createDialog.name}
        initialMatches={createDialog.matches}
        initialError={createDialog.error}
        defaultCategory={category}
        contextCategory={category}
        lockCategory
        onPickMatch={pickMatch}
        onCreated={handleDialogCreated}
        onCancel={() => finishPanel(undefined)}
      />
    </div>
  );
}

// ─── Edit dialog (creator / admin) ─────────────────────────────────────────
// Rendered through a portal but still inside the React tree of the enquiry
// form, so it deliberately has no <form>: a submit would bubble up to it.

interface ClientEditDialogProps {
  // The client being edited; null keeps the dialog closed.
  client: Client | null;
  onClose: () => void;
  onSaved: (client: Client) => void;
}

/**
 * Live, read-only username for a client being renamed. Returns the current
 * username while the name is unchanged, the server's suggestion for the new
 * name once it arrives (the same username when the name slugs the same), and
 * '' while a suggestion is pending.
 */
export function useClientUsernamePreview(name: string, client: Client | null): string {
  const [preview, setPreview] = useState({ name: '', username: '' });
  const changed = !!client && !!name && name !== client.name;
  useEffect(() => {
    if (!changed || !client) return;
    let stale = false;
    const timer = setTimeout(async () => {
      const res = await suggestClientUsername(name, client.id);
      if (!stale) setPreview({ name, username: res.data?.username ?? '' });
    }, 300);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [changed, name, client]);
  if (!client) return '';
  if (!changed) return client.username;
  return preview.name === name ? preview.username : '';
}

export function ClientEditDialog({ client, onClose, onSaved }: ClientEditDialogProps) {
  const categories = useClientCategories();
  const [name, setName] = useState('');
  const [editCategories, setEditCategories] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  // Reset the fields whenever the dialog opens on a client.
  const [openedFor, setOpenedFor] = useState<Client | null>(null);
  if (client !== openedFor) {
    setOpenedFor(client);
    if (client) {
      setName(client.name);
      setEditCategories(client.categories);
      setNotes(client.notes ?? '');
      setIsActive(client.is_active);
      setError('');
    }
  }

  const cleanedName = name.trim().replace(/\s+/g, ' ');
  const cleanedNotes = notes.trim();
  const previewUsername = useClientUsernamePreview(cleanedName, client);
  const nameTooLong = cleanedName.length > MAX_NAME_LENGTH;
  const notesTooLong = cleanedNotes.length > CLIENT_NOTES_MAX_LENGTH;
  const canSave =
    !isSaving && cleanedName !== '' && !nameTooLong && !notesTooLong && editCategories.length > 0;

  const save = async () => {
    if (!client || !canSave) return;
    const data: Parameters<typeof updateClient>[1] = {};
    if (cleanedName !== client.name) {
      data.name = cleanedName;
      if (previewUsername) data.username = previewUsername;
    }
    const sameCategories =
      editCategories.length === client.categories.length &&
      editCategories.every((c) => client.categories.includes(c));
    if (!sameCategories) data.categories = editCategories;
    if (cleanedNotes !== (client.notes ?? '')) data.notes = cleanedNotes;
    if (isActive !== client.is_active) data.is_active = isActive;
    if (Object.keys(data).length === 0) {
      onClose();
      return;
    }
    setIsSaving(true);
    setError('');
    const res = await updateClient(client.id, data);
    setIsSaving(false);
    if (res.data) {
      onSaved(res.data);
    } else {
      setError(clientErrorMessage(res, 'Failed to update client'));
    }
  };

  return (
    <Dialog
      open={!!client}
      onOpenChange={(open) => {
        if (!open && !isSaving) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit client</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="client-edit-name">Name *</Label>
            <Input
              id="client-edit-name"
              autoFocus
              value={name}
              maxLength={MAX_NAME_LENGTH + 50}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  save();
                }
              }}
            />
            {nameTooLong && (
              <p className="text-xs text-red-600">
                Name must be {MAX_NAME_LENGTH} characters or fewer.
              </p>
            )}
          </div>

          {client && (
            <div className="space-y-1.5">
              <Label htmlFor="client-edit-username">Username</Label>
              <Input
                id="client-edit-username"
                readOnly
                tabIndex={-1}
                value={previewUsername}
                placeholder="Generating…"
                className="bg-[#F4F4F5] text-[#52525B] font-mono"
              />
              {previewUsername !== client.username && (
                <p className="text-xs text-[#A1A1AA]">was {client.username}</p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
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

          <div className="space-y-1.5">
            <Label htmlFor="client-edit-notes">Notes</Label>
            <Textarea
              id="client-edit-notes"
              value={notes}
              maxLength={CLIENT_NOTES_MAX_LENGTH}
              rows={3}
              placeholder="Optional"
              onChange={(e) => setNotes(e.target.value)}
            />
            {notesTooLong && (
              <p className="text-xs text-red-600">
                Notes must be {CLIENT_NOTES_MAX_LENGTH} characters or fewer.
              </p>
            )}
          </div>

          <label className="inline-flex items-center gap-2 text-sm">
            <Checkbox
              checked={isActive}
              onCheckedChange={(checked) => setIsActive(checked === true)}
            />
            Active
          </label>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-md text-sm">
              {error}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={isSaving} onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={!canSave} onClick={save}>
            {isSaving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
