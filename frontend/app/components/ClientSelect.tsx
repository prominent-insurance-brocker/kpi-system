'use client';

/**
 * Picker for the saved Client list, scoped to one parent category (e.g.
 * 'marine'). Wraps SearchableSelect: server-side search + infinite scroll over
 * GET /api/entries/clients/?category=…&is_active=true.
 *
 * Typing a name with no exact match offers "+ Add", which opens a small inline
 * panel: the name (pre-filled) and a category multi-select with the module's
 * own category ticked. A same-name 409 lists the existing matches to pick from,
 * plus "Create new anyway" (resends with force=true).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { SearchableSelect } from '@/components/ui/searchable-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  listClients,
  createClient,
  getClientCategories,
  clientDuplicateMatches,
  firstFieldError,
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
    firstFieldError(res, ['name', 'categories', 'is_active', 'non_field_errors', 'detail']) ||
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
  // id) can hand the full client (name included) back to the form.
  const seenRef = useRef(new Map<string, ClientRef>());

  const fetchPage = useCallback(
    async ({ search, page }: { search: string; page: number }) => {
      const res = await listClients({ category, search, page, is_active: true });
      const rows = res.data?.results ?? [];
      for (const c of rows) seenRef.current.set(String(c.id), c);
      return { results: rows as ClientRef[], hasMore: !!res.data?.next };
    },
    [category]
  );

  // ── Inline create panel ────────────────────────────────────────────────
  // onCreate returns a promise that settles when the panel finishes: with the
  // client to select, or undefined on cancel.
  const resolveRef = useRef<((client: ClientRef | undefined) => void) | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCategories, setNewCategories] = useState<string[]>([category]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Sync guard: a fast double click lands before isSubmitting re-renders.
  const submittingRef = useRef(false);
  const [panelError, setPanelError] = useState('');
  const [matches, setMatches] = useState<ClientDuplicateError['matches'] | null>(null);

  // Settle a pending create if the form unmounts with the panel open.
  useEffect(() => () => resolveRef.current?.(undefined), []);

  const finishPanel = (client: ClientRef | undefined) => {
    setIsPanelOpen(false);
    setMatches(null);
    setPanelError('');
    const resolve = resolveRef.current;
    resolveRef.current = null;
    resolve?.(client);
  };

  const handleCreateRequest = (search: string) => {
    resolveRef.current?.(undefined);
    setNewName(search);
    setNewCategories([category]);
    setPanelError('');
    setMatches(null);
    setIsPanelOpen(true);
    return new Promise<ClientRef | undefined>((resolve) => {
      resolveRef.current = resolve;
    });
  };

  const toggleCategory = (key: string, checked: boolean) => {
    setNewCategories((prev) =>
      checked ? (prev.includes(key) ? prev : [...prev, key]) : prev.filter((k) => k !== key)
    );
    setMatches(null);
  };

  const cleanedName = newName.trim().replace(/\s+/g, ' ');
  const nameTooLong = cleanedName.length > MAX_NAME_LENGTH;
  const canSubmit =
    !isSubmitting && cleanedName !== '' && !nameTooLong && newCategories.length > 0;

  const submitCreate = async (force: boolean) => {
    if (!canSubmit || submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    setPanelError('');
    const res = await createClient({
      name: cleanedName,
      categories: newCategories,
      ...(force ? { force: true } : {}),
    });
    submittingRef.current = false;
    setIsSubmitting(false);
    if (res.data) {
      const created = res.data;
      seenRef.current.set(String(created.id), created);
      if (created.categories.includes(category)) {
        toast.success('Client added');
        finishPanel(created);
      } else {
        // Not tagged with this module's category, so it can't be used here.
        toast.success(`Client added (not in the ${categoryLabel} list)`);
        finishPanel(undefined);
      }
      return;
    }
    const dupes = clientDuplicateMatches(res);
    if (dupes) {
      setMatches(dupes);
      return;
    }
    // Validation or network error: keep the panel and typed text as they are.
    setPanelError(clientErrorMessage(res, 'Failed to add client'));
  };

  const pickMatch = (match: ClientRef) => {
    seenRef.current.set(String(match.id), match);
    finishPanel(match);
  };

  return (
    <div className="space-y-2">
      <SearchableSelect<ClientRef>
        value={value ? String(value) : null}
        onValueChange={(v) => {
          onChange(v ? seenRef.current.get(v) ?? null : null);
        }}
        fetchPage={fetchPage}
        getOptionValue={(c) => String(c.id)}
        getOptionLabel={clientLabel}
        getCreateMatchText={(c) => c.name}
        placeholder={placeholder}
        emptyLabel="No clients found"
        selectedLabel={selectedLabel}
        disabled={disabled || isPanelOpen}
        onCreate={handleCreateRequest}
        createLabel={(search) => `Add "${search}" as a new client`}
      />

      {isPanelOpen && (
        <div className="rounded-md border border-[#E4E4E4] bg-[#FAFAFA] p-3 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="client-select-new-name">New client name *</Label>
            <Input
              id="client-select-new-name"
              autoFocus
              value={newName}
              maxLength={MAX_NAME_LENGTH + 50}
              onChange={(e) => {
                setNewName(e.target.value);
                setMatches(null);
              }}
              onKeyDown={(e) => {
                // This panel lives inside the enquiry <form>; Enter must
                // create the client, not submit the enquiry.
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  submitCreate(matches !== null);
                }
              }}
            />
            {nameTooLong && (
              <p className="text-xs text-red-600">
                Name must be {MAX_NAME_LENGTH} characters or fewer.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Categories *</Label>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {categories.map((c) => (
                <label key={c.value} className="inline-flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={newCategories.includes(c.value)}
                    onCheckedChange={(checked) => toggleCategory(c.value, checked === true)}
                  />
                  {c.label}
                </label>
              ))}
            </div>
            {newCategories.length === 0 ? (
              <p className="text-xs text-red-600">Pick at least one category.</p>
            ) : (
              !newCategories.includes(category) && (
                <p className="text-xs text-amber-700">
                  Without {categoryLabel} ticked, this client won&apos;t appear in the{' '}
                  {categoryLabel} list.
                </p>
              )
            )}
          </div>

          {matches && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-2 space-y-2">
              <p className="text-sm font-medium text-amber-900">Client already exists</p>
              <ul className="space-y-1">
                {matches.map((m) => {
                  const usable = m.categories.includes(category);
                  return (
                    <li key={m.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate">{clientLabel(m)}</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!usable}
                        title={usable ? undefined : `Not in the ${categoryLabel} list`}
                        onClick={() => pickMatch(m)}
                      >
                        Use this
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {panelError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-md text-sm">
              {panelError}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => finishPanel(undefined)}
            >
              Cancel
            </Button>
            {matches ? (
              <Button
                type="button"
                size="sm"
                disabled={!canSubmit}
                onClick={() => submitCreate(true)}
              >
                {isSubmitting ? 'Adding…' : 'Create new anyway'}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                disabled={!canSubmit}
                onClick={() => submitCreate(false)}
              >
                {isSubmitting ? 'Adding…' : 'Add client'}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
