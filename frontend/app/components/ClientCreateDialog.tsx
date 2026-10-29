'use client';

/**
 * "New client" dialog, shared by the client picker (ClientSelect: the + button
 * and its 'Create "<name>"' row) and Settings → Clients.
 *
 * Fields: full name, a live read-only @username (the exact one the server keeps
 * if it is still free), a category multi-select with `defaultCategory` ticked,
 * and optional notes. With `lockCategory` (creating from inside a module)
 * `defaultCategory` stays ticked and can't be unticked; other categories can
 * still be added. A same-name 409 lists the existing matches; with
 * `onPickMatch` each match gets "Use this", and "Create new anyway" resends
 * with force=true.
 *
 * Rendered through a portal but often inside an enquiry form's React tree, so
 * it deliberately has no <form>: a submit would bubble up to it.
 */

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

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
import { clientErrorMessage, clientLabel, useClientCategories } from '@/app/components/ClientSelect';
import {
  createClient,
  suggestClientUsername,
  clientDuplicateMatches,
  CLIENT_NOTES_MAX_LENGTH,
  type Client,
  type ClientRef,
  type ClientDuplicateError,
} from '@/app/lib/api';

const MAX_NAME_LENGTH = 200;

export interface ClientCreateDialogProps {
  open: boolean;
  // Pre-filled values, applied each time the dialog opens.
  initialName?: string;
  initialMatches?: ClientDuplicateError['matches'] | null;
  initialError?: string;
  // Category ticked by default (the module's own category; 'marine' in Settings).
  defaultCategory: string;
  // When set, untick-warning names this list ("won't appear in the Marine list").
  contextCategory?: string;
  // Keep defaultCategory ticked (create from inside a module); others stay free.
  lockCategory?: boolean;
  // Offer "Use this" on duplicate matches (picker only).
  onPickMatch?: (match: ClientRef) => void;
  onCreated: (client: Client) => void;
  onCancel: () => void;
}

export function ClientCreateDialog({
  open,
  initialName = '',
  initialMatches = null,
  initialError = '',
  defaultCategory,
  contextCategory,
  lockCategory = false,
  onPickMatch,
  onCreated,
  onCancel,
}: ClientCreateDialogProps) {
  const categories = useClientCategories();
  const contextLabel = contextCategory
    ? (categories.find((c) => c.value === contextCategory)?.label ?? contextCategory)
    : '';

  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string[]>([defaultCategory]);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [matches, setMatches] = useState<ClientDuplicateError['matches'] | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Sync guard: a fast double click lands before isSubmitting re-renders.
  const submittingRef = useRef(false);

  // Reset the fields each time the dialog opens.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName(initialName);
      setSelected([defaultCategory]);
      setNotes('');
      setError(initialError);
      setMatches(initialMatches);
    }
  }

  const cleanedName = name.trim().replace(/\s+/g, ' ');
  const cleanedNotes = notes.trim();

  // Live, read-only username for the typed name.
  const [preview, setPreview] = useState({ name: '', username: '' });
  const previewUsername = preview.name === cleanedName ? preview.username : '';
  useEffect(() => {
    if (!open || !cleanedName) return;
    let stale = false;
    const timer = setTimeout(async () => {
      const res = await suggestClientUsername(cleanedName);
      if (!stale) setPreview({ name: cleanedName, username: res.data?.username ?? '' });
    }, 300);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [open, cleanedName]);

  const nameTooLong = cleanedName.length > MAX_NAME_LENGTH;
  const notesTooLong = cleanedNotes.length > CLIENT_NOTES_MAX_LENGTH;
  const canSubmit =
    !isSubmitting && cleanedName !== '' && !nameTooLong && !notesTooLong && selected.length > 0;

  const defaultLabel =
    categories.find((c) => c.value === defaultCategory)?.label ?? defaultCategory;

  const isLocked = (key: string) => lockCategory && key === defaultCategory;

  const toggleCategory = (key: string, checked: boolean) => {
    if (isLocked(key)) return;
    setSelected((prev) =>
      checked ? (prev.includes(key) ? prev : [...prev, key]) : prev.filter((k) => k !== key)
    );
    setMatches(null);
  };

  const submit = async (force: boolean) => {
    if (!canSubmit || submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    setError('');
    const res = await createClient({
      name: cleanedName,
      categories: selected,
      notes: cleanedNotes,
      ...(previewUsername ? { username: previewUsername } : {}),
      ...(force ? { force: true } : {}),
    });
    submittingRef.current = false;
    setIsSubmitting(false);
    if (res.data) {
      if (res.data.username_changed) {
        toast.info(`${previewUsername} was just taken, so the username is ${res.data.username}`);
      }
      onCreated(res.data);
      return;
    }
    const dupes = clientDuplicateMatches(res);
    if (dupes) {
      setMatches(dupes);
      return;
    }
    // Validation or network error: keep the dialog and typed text as they are.
    setError(clientErrorMessage(res, 'Failed to add client'));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !isSubmitting) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New client</DialogTitle>
        </DialogHeader>
        <div className="min-w-0 space-y-4">
          <p className="text-xs text-amber-700">
            Search the client list first: check the client doesn&apos;t already exist before
            creating a new one.
          </p>

          <div className="space-y-1.5">
            <Label htmlFor="client-create-name">Full name *</Label>
            <Input
              id="client-create-name"
              autoFocus
              value={name}
              maxLength={MAX_NAME_LENGTH + 50}
              onChange={(e) => {
                setName(e.target.value);
                setMatches(null);
              }}
              onKeyDown={(e) => {
                // Often inside an enquiry form's React tree: Enter must create
                // the client, not submit the enquiry.
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  submit(matches !== null);
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
            <Label htmlFor="client-create-username">Username</Label>
            <Input
              id="client-create-username"
              readOnly
              tabIndex={-1}
              value={previewUsername}
              placeholder="Generated from the name"
              className="bg-[#F4F4F5] text-[#52525B] font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Categories *</Label>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {categories.map((c) => (
                <label
                  key={c.value}
                  className={`inline-flex items-center gap-2 text-sm${
                    isLocked(c.value) ? ' cursor-not-allowed' : ''
                  }`}
                  // Disabled checkboxes get no hover events, so the reason
                  // sits on the label.
                  title={
                    isLocked(c.value)
                      ? `Created from ${defaultLabel}, so it is always tagged ${defaultLabel}`
                      : undefined
                  }
                >
                  <Checkbox
                    checked={selected.includes(c.value)}
                    disabled={isLocked(c.value)}
                    onCheckedChange={(checked) => toggleCategory(c.value, checked === true)}
                  />
                  {c.label}
                </label>
              ))}
            </div>
            {lockCategory && (
              <p className="text-xs text-[#71717A]">
                Created from {defaultLabel}, so {defaultLabel} can&apos;t be unticked. You can tick
                other categories too.
              </p>
            )}
            {selected.length === 0 ? (
              <p className="text-xs text-red-600">Pick at least one category.</p>
            ) : (
              contextCategory &&
              !selected.includes(contextCategory) && (
                <p className="text-xs text-amber-700">
                  Without {contextLabel} ticked, this client won&apos;t appear in the{' '}
                  {contextLabel} list.
                </p>
              )
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="client-create-notes">Notes</Label>
            <Textarea
              id="client-create-notes"
              value={notes}
              maxLength={CLIENT_NOTES_MAX_LENGTH}
              rows={2}
              placeholder="Optional"
              onChange={(e) => setNotes(e.target.value)}
            />
            {notesTooLong && (
              <p className="text-xs text-red-600">
                Notes must be {CLIENT_NOTES_MAX_LENGTH} characters or fewer.
              </p>
            )}
          </div>

          {matches && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-2 space-y-2">
              <p className="text-sm font-medium text-amber-900">Client already exists</p>
              <ul className="space-y-1">
                {matches.map((m) => {
                  const usable = !contextCategory || m.categories.includes(contextCategory);
                  return (
                    <li key={m.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate" title={clientLabel(m)}>
                        {clientLabel(m)}
                      </span>
                      {onPickMatch && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={!usable}
                          title={usable ? undefined : `Not in the ${contextLabel} list`}
                          onClick={() => onPickMatch(m)}
                        >
                          Use this
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-md text-sm">
              {error}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={isSubmitting} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" disabled={!canSubmit} onClick={() => submit(matches !== null)}>
            {isSubmitting ? 'Creating…' : matches ? 'Create new anyway' : 'Create client'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
