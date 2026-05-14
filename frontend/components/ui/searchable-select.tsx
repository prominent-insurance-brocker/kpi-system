'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronsUpDown, Search, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface SearchableSelectPage<T> {
  results: T[];
  hasMore: boolean;
}

export interface SearchableSelectProps<T> {
  value: string | null;
  onValueChange: (value: string) => void;
  fetchPage: (params: { search: string; page: number }) => Promise<SearchableSelectPage<T>>;
  getOptionValue: (item: T) => string;
  getOptionLabel: (item: T) => string;
  placeholder?: string;
  emptyLabel?: string;
  // Label to display in the trigger when `value` is set but the matching
  // item hasn't been clicked or loaded yet (e.g., on Edit / sticky URL filter).
  selectedLabel?: string | null;
  // If set, shows a "clear" sentinel at the top of the list that sets value to ''.
  clearLabel?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
}

const DEBOUNCE_MS = 250;

export function SearchableSelect<T>({
  value,
  onValueChange,
  fetchPage,
  getOptionValue,
  getOptionLabel,
  placeholder = 'Select…',
  emptyLabel = 'No results',
  selectedLabel,
  clearLabel,
  disabled,
  className,
  triggerClassName,
}: SearchableSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<T[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  // Remember the last picked item so the trigger keeps showing its label
  // after the popover closes (even though we reset `items` between sessions).
  const [pickedItem, setPickedItem] = useState<T | null>(null);

  // Debounce the search input so we don't flood the backend on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Reset search-related state every time the popover closes so a fresh open
  // starts at page 1. We deliberately keep `pickedItem` around so the trigger
  // still shows the selected name.
  useEffect(() => {
    if (!open) {
      setSearchInput('');
      setSearch('');
      setItems([]);
      setPage(1);
      setHasMore(false);
    }
  }, [open]);

  // Load page 1 whenever the popover opens or the (debounced) search changes.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    fetchPage({ search, page: 1 }).then((res) => {
      if (cancelled) return;
      setItems(res.results);
      setHasMore(res.hasMore);
      setPage(1);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, search, fetchPage]);

  const loadMore = useCallback(() => {
    if (loading || !hasMore) return;
    setLoading(true);
    const next = page + 1;
    fetchPage({ search, page: next }).then((res) => {
      setItems((prev) => [...prev, ...res.results]);
      setHasMore(res.hasMore);
      setPage(next);
      setLoading(false);
    });
  }, [loading, hasMore, page, search, fetchPage]);

  // Infinite scroll via IntersectionObserver on a sentinel at list end.
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || !hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: '40px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [open, hasMore, loadMore]);

  // What to render inside the trigger button.
  const triggerLabel = (() => {
    if (!value) return placeholder;
    if (pickedItem && getOptionValue(pickedItem) === value) return getOptionLabel(pickedItem);
    const found = items.find((i) => getOptionValue(i) === value);
    if (found) return getOptionLabel(found);
    return selectedLabel ?? placeholder;
  })();

  const handlePick = (item: T) => {
    setPickedItem(item);
    onValueChange(getOptionValue(item));
    setOpen(false);
  };

  const handleClear = () => {
    setPickedItem(null);
    onValueChange('');
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
            !value && 'text-muted-foreground',
            className,
            triggerClassName
          )}
        >
          <span className="truncate">{triggerLabel}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-[var(--radix-popover-trigger-width)] p-0"
      >
        <div className="flex items-center border-b px-3 py-2">
          <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            autoFocus
          />
        </div>
        <div
          className="max-h-[240px] overflow-y-auto scrollbar-hide py-1 overscroll-contain"
          onWheel={(e) => e.stopPropagation()}
        >
          {clearLabel && (
            <button
              type="button"
              onClick={handleClear}
              className={cn(
                'flex w-full items-center px-3 py-2 text-left text-sm hover:bg-accent',
                !value && 'bg-accent/50'
              )}
            >
              <X className="mr-2 h-4 w-4 shrink-0 opacity-50" />
              <span className="truncate text-muted-foreground">{clearLabel}</span>
            </button>
          )}
          {items.length === 0 && !loading ? (
            <div className="px-3 py-4 text-center text-sm text-muted-foreground">
              {emptyLabel}
            </div>
          ) : (
            <>
              {items.map((item) => {
                const v = getOptionValue(item);
                const selected = v === value;
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => handlePick(item)}
                    className="flex w-full items-center px-3 py-2 text-left text-sm hover:bg-accent"
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4 shrink-0',
                        selected ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    <span className="truncate">{getOptionLabel(item)}</span>
                  </button>
                );
              })}
              {hasMore && (
                <div
                  ref={sentinelRef}
                  className="py-2 text-center text-xs text-muted-foreground"
                >
                  {loading ? 'Loading…' : 'Scroll for more'}
                </div>
              )}
              {!hasMore && loading && items.length > 0 && (
                <div className="py-2 text-center text-xs text-muted-foreground">
                  Loading…
                </div>
              )}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
