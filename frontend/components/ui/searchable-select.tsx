'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronsUpDown, Plus, Search, X } from 'lucide-react';
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
  // Opt-in "+ Add" row. When set, a create row is shown below the list while
  // the search text has no exact match. The popover closes and `onCreate`
  // gets the trimmed search text; if it resolves to an item, that item is
  // selected (as if clicked). Resolve to nothing to leave the value alone.
  onCreate?: (search: string) => Promise<T | void> | T | void;
  // Text of the create row; defaults to `Add "<search>"`.
  createLabel?: (search: string) => string;
  // Text compared (case/space-insensitive) against the search to decide if an
  // item is an exact match that hides the create row. Defaults to the label.
  getCreateMatchText?: (item: T) => string;
  // Keep the create row even when an item matches the search exactly (e.g. a
  // second client may share a name). Defaults to hiding it on an exact match.
  alwaysShowCreate?: boolean;
  // Opt-in second line under each option's label (small, light gray), e.g. a
  // client's @username. Not shown in the trigger.
  getOptionSubtitle?: (item: T) => string | null | undefined;
  // Opt-in label for the closed trigger; defaults to getOptionLabel.
  getTriggerLabel?: (item: T) => string;
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
  onCreate,
  createLabel,
  getCreateMatchText,
  alwaysShowCreate,
  getOptionSubtitle,
  getTriggerLabel,
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

  // Keyboard navigation — visual index into [clear sentinel?, ...items]. -1 means no highlight.
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  // Wipe stale refs on every render so removed rows don't leak entries.
  itemRefs.current = [];
  // Tracks whether the initial highlight has been seeded for the current
  // open-cycle. The seed waits until items finish loading so we can honor
  // `value` (highlight the selected row), then locks in — subsequent
  // appends from infinite scroll or user keyboard moves don't re-seed.
  const seededRef = useRef(false);

  const clearOffset = clearLabel ? 1 : 0;

  // Create row (opt-in): sits after the items, so it never shifts their indices.
  const normalise = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase();
  const createText = search.trim().replace(/\s+/g, ' ');
  // Hidden while the debounce is pending, so Enter never creates a stale name.
  const showCreate =
    !!onCreate &&
    createText !== '' &&
    createText === searchInput.trim().replace(/\s+/g, ' ') &&
    !loading &&
    (alwaysShowCreate ||
      !items.some(
        (it) => normalise((getCreateMatchText ?? getOptionLabel)(it)) === normalise(createText)
      ));
  const createIndex = items.length + clearOffset;
  const navLength = items.length + clearOffset + (showCreate ? 1 : 0);

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
      setHighlightedIndex(-1);
      seededRef.current = false;
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

  // Seed the keyboard highlight ONCE per open cycle, after the items list
  // has resolved. Two-phase: defer while the page-1 fetch is in flight so we
  // can match `value` against the real loaded items; then lock in via
  // `seededRef` so infinite-scroll appends and keyboard moves don't reset.
  useEffect(() => {
    if (!open) return;
    if (seededRef.current) {
      // Already seeded — only re-evaluate if the highlight fell out of range
      // (e.g., search narrowed the result set below the previous index).
      setHighlightedIndex((prev) => (prev >= navLength ? Math.max(-1, navLength - 1) : prev));
      return;
    }
    // Wait for the initial fetch to settle. If nothing has loaded yet and we
    // also have no clear sentinel, there's no row to highlight.
    if (loading && items.length === 0) return;
    if (navLength === 0) {
      setHighlightedIndex(-1);
      seededRef.current = true;
      return;
    }
    if (value) {
      const idx = items.findIndex((it) => getOptionValue(it) === value);
      if (idx >= 0) {
        setHighlightedIndex(idx + clearOffset);
        seededRef.current = true;
        return;
      }
    }
    // Fallback: first navigable row (clear sentinel if present, else first item).
    setHighlightedIndex(0);
    seededRef.current = true;
    // We intentionally depend on items.length, not items, so appending more
    // pages (length grows; existing entries stable) doesn't re-seed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, items.length, loading, navLength, clearOffset, value]);

  // Auto-scroll the highlighted row into view.
  useEffect(() => {
    if (highlightedIndex < 0) return;
    itemRefs.current[highlightedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex]);

  // What to render inside the trigger button.
  const triggerLabel = (() => {
    if (!value) return placeholder;
    const label = getTriggerLabel ?? getOptionLabel;
    if (pickedItem && getOptionValue(pickedItem) === value) return label(pickedItem);
    const found = items.find((i) => getOptionValue(i) === value);
    if (found) return label(found);
    return selectedLabel ?? placeholder;
  })();

  const handlePick = (item: T) => {
    setPickedItem(item);
    onValueChange(getOptionValue(item));
    setOpen(false);
  };

  const handleCreate = async () => {
    if (!onCreate || !createText) return;
    setOpen(false);
    const created = await onCreate(createText);
    if (created) {
      setPickedItem(created);
      onValueChange(getOptionValue(created));
    }
  };

  const handleClear = () => {
    setPickedItem(null);
    onValueChange('');
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Don't hijack IME composition (e.g., Asian-language input).
    if (e.nativeEvent.isComposing) return;
    if (navLength === 0) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex((i) => ((i < 0 ? -1 : i) + 1) % navLength);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((i) => (i <= 0 ? navLength - 1 : i - 1));
        break;
      case 'Home':
        e.preventDefault();
        setHighlightedIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setHighlightedIndex(navLength - 1);
        break;
      case 'Enter': {
        e.preventDefault();
        if (highlightedIndex < 0) return;
        if (clearLabel && highlightedIndex === 0) {
          handleClear();
        } else if (showCreate && highlightedIndex === createIndex) {
          handleCreate();
        } else {
          const item = items[highlightedIndex - clearOffset];
          if (item != null) handlePick(item);
        }
        break;
      }
      // Escape + Tab fall through to native handling (Radix closes on Esc,
      // Tab moves focus normally).
    }
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
            onChange={(e) => {
              setSearchInput(e.target.value);
              // Snap the highlight to the first row immediately on type, so the
              // visual lead doesn't lag behind the debounced refetch.
              setHighlightedIndex(clearOffset);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            autoFocus
            role="combobox"
            aria-expanded={open}
            aria-controls="searchable-select-listbox"
            aria-activedescendant={
              highlightedIndex >= 0 ? `searchable-select-opt-${highlightedIndex}` : undefined
            }
          />
        </div>
        <div
          id="searchable-select-listbox"
          role="listbox"
          className="max-h-[240px] overflow-y-auto scrollbar-hide py-1 overscroll-contain"
          onWheel={(e) => e.stopPropagation()}
        >
          {clearLabel && (
            <button
              ref={(el) => {
                itemRefs.current[0] = el;
              }}
              id="searchable-select-opt-0"
              role="option"
              aria-selected={highlightedIndex === 0}
              type="button"
              onClick={handleClear}
              onMouseEnter={() => setHighlightedIndex(0)}
              className={cn(
                'flex w-full items-center px-3 py-2 text-left text-sm',
                highlightedIndex === 0 ? 'bg-accent' : 'hover:bg-accent',
                !value && highlightedIndex !== 0 && 'bg-accent/50'
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
              {items.map((item, idx) => {
                const visualIndex = idx + clearOffset;
                const v = getOptionValue(item);
                const selected = v === value;
                const isHighlighted = highlightedIndex === visualIndex;
                return (
                  <button
                    key={v}
                    ref={(el) => {
                      itemRefs.current[visualIndex] = el;
                    }}
                    id={`searchable-select-opt-${visualIndex}`}
                    role="option"
                    aria-selected={isHighlighted}
                    type="button"
                    onClick={() => handlePick(item)}
                    onMouseEnter={() => setHighlightedIndex(visualIndex)}
                    className={cn(
                      'flex w-full items-center px-3 py-2 text-left text-sm',
                      isHighlighted ? 'bg-accent' : 'hover:bg-accent'
                    )}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4 shrink-0',
                        selected ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    {getOptionSubtitle ? (
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{getOptionLabel(item)}</span>
                        {getOptionSubtitle(item) && (
                          <span className="truncate text-xs text-[#A1A1AA]">
                            {getOptionSubtitle(item)}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="truncate">{getOptionLabel(item)}</span>
                    )}
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
        {showCreate && (
          <div className="border-t py-1">
            <button
              ref={(el) => {
                itemRefs.current[createIndex] = el;
              }}
              id={`searchable-select-opt-${createIndex}`}
              role="option"
              aria-selected={highlightedIndex === createIndex}
              type="button"
              onClick={handleCreate}
              onMouseEnter={() => setHighlightedIndex(createIndex)}
              className={cn(
                'flex w-full items-center px-3 py-2 text-left text-sm',
                highlightedIndex === createIndex ? 'bg-accent' : 'hover:bg-accent'
              )}
            >
              <Plus className="mr-2 h-4 w-4 shrink-0 opacity-70" />
              <span className="truncate">
                {createLabel ? createLabel(createText) : `Add "${createText}"`}
              </span>
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
