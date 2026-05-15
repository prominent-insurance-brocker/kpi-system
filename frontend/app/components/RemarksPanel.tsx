'use client';

/**
 * Cross-module per-entry comments panel.
 *
 * Renders INLINE next to the table (a 360px shrink-0 aside in a flex row) —
 * NOT as a Sheet/drawer. Parent decides visibility by passing `open` and
 * controls layout by placing this as a sibling of the table's flex-1 child.
 *
 * Used by the 7 modules that support comments (general_new, general_renewal,
 * motor_new, motor_renewal, motor_fleet_new, motor_fleet_renewal, motor_claim).
 * Permissions: only the comment's author can edit/delete (no admin override).
 */

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Pencil, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';

import {
  createRemark,
  deleteRemark,
  listRemarks,
  updateRemark,
  type EntryRemark,
} from '@/app/lib/api';
import { formatDateTimeShort } from '@/app/lib/date';
import { useConfirm } from '@/app/components/ConfirmDialog';

export interface RemarksPanelProps {
  contentTypeId: number | null;
  objectId: number | null;
  entryLabel: string;     // shown in header, e.g. "Motor Claim — PIB-42"
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RemarksPanel({
  contentTypeId,
  objectId,
  entryLabel,
  open,
  onOpenChange,
}: RemarksPanelProps) {
  const [remarks, setRemarks] = useState<EntryRemark[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [newText, setNewText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // edit state: id of comment being edited (or null) + draft text
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState('');

  const confirm = useConfirm();

  const fetchList = useCallback(async () => {
    if (contentTypeId == null || objectId == null) return;
    setIsLoading(true);
    const res = await listRemarks(contentTypeId, objectId);
    setIsLoading(false);
    if (res.data) {
      setRemarks(res.data.results);
    } else {
      toast.error(res.error || 'Failed to load comments');
    }
  }, [contentTypeId, objectId]);

  useEffect(() => {
    if (open) {
      setNewText('');
      setEditingId(null);
      fetchList();
    }
  }, [open, fetchList]);

  const handleAdd = async () => {
    if (contentTypeId == null || objectId == null) return;
    const text = newText.trim();
    if (!text) return;
    setIsSubmitting(true);
    const res = await createRemark(contentTypeId, objectId, text);
    setIsSubmitting(false);
    if (res.data) {
      setNewText('');
      fetchList();
    } else {
      toast.error(res.error || 'Failed to add comment');
    }
  };

  const handleSaveEdit = async (id: number) => {
    const text = editDraft.trim();
    if (!text) return;
    const res = await updateRemark(id, text);
    if (res.data) {
      setEditingId(null);
      fetchList();
    } else {
      toast.error(res.error || 'Failed to update comment');
    }
  };

  const handleDelete = async (id: number) => {
    const ok = await confirm({
      title: 'Delete this comment?',
      description: 'This action cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    const res = await deleteRemark(id);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    fetchList();
  };

  if (!open) return null;

  return (
    <aside className="w-[360px] shrink-0 self-start bg-white border border-[#E4E4E4] rounded-2xl shadow-sm overflow-hidden flex flex-col max-h-[calc(100vh-200px)]">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#E4E4E4]">
        <h3 className="text-sm font-semibold text-[#09090B] truncate">
          Comments{entryLabel ? ` — ${entryLabel}` : ''}
        </h3>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-[#F3F3F3] shrink-0"
          aria-label="Close comments panel"
        >
          <X className="h-4 w-4 text-[#71717A]" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
        {/* Composer */}
        <div className="rounded-md border bg-zinc-50 p-3 space-y-3">
          <Textarea
            placeholder="Type here..."
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            rows={4}
            className="bg-white"
          />
          <div>
            <Button
              onClick={handleAdd}
              disabled={isSubmitting || !newText.trim()}
              variant="outline"
            >
              {isSubmitting ? 'Adding…' : 'Add Comment'}
            </Button>
          </div>
        </div>

        {/* All comments */}
        <div>
          <div className="text-xs font-semibold tracking-wide text-zinc-700 uppercase">
            All Comments
          </div>
          <div className="h-px bg-zinc-200 mt-2 mb-3" />

          {isLoading && remarks.length === 0 ? (
            <p className="text-sm text-zinc-500">Loading…</p>
          ) : remarks.length === 0 ? (
            <p className="text-sm text-zinc-500">No comments yet.</p>
          ) : (
            <ul className="space-y-4">
              {remarks.map((r) => (
                <li key={r.id}>
                  {editingId === r.id ? (
                    <div className="rounded-md border bg-white p-3 space-y-2">
                      <Textarea
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        rows={3}
                        autoFocus
                      />
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditingId(null)}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleSaveEdit(r.id)}
                          disabled={!editDraft.trim()}
                        >
                          Save
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="rounded-md bg-zinc-50 px-3 py-2 flex items-start gap-2">
                        <p className="text-sm text-zinc-800 whitespace-pre-wrap flex-1 break-words">
                          {r.text}
                        </p>
                        {(r.can_edit || r.can_delete) && (
                          <div className="flex items-center gap-1 shrink-0">
                            {r.can_edit && (
                              <button
                                type="button"
                                aria-label="Edit comment"
                                className="p-1 rounded hover:bg-zinc-200 text-zinc-600"
                                onClick={() => {
                                  setEditingId(r.id);
                                  setEditDraft(r.text);
                                }}
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                            )}
                            {r.can_delete && (
                              <button
                                type="button"
                                aria-label="Delete comment"
                                className="p-1 rounded hover:bg-zinc-200 text-zinc-600"
                                onClick={() => handleDelete(r.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="text-xs text-zinc-500 mt-1">
                        {formatDateTimeShort(r.created_at)}
                        {!r.can_edit && r.author_name ? ` · ${r.author_name}` : ''}
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </aside>
  );
}
