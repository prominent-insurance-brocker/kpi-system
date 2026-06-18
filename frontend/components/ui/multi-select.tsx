'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface MultiSelectProps<T> {
  options: T[];
  value: string[];
  onChange: (value: string[]) => void;
  getOptionValue: (item: T) => string;
  getOptionLabel: (item: T) => string;
  // Trigger text + reset-row label shown when nothing is selected.
  placeholder?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  // Trigger summary when 2+ are selected; defaults to "N selected".
  summarize?: (count: number) => string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
}

/**
 * In-memory searchable multi-select (Popover + search box + checkbox rows).
 * `value` is the list of selected option values; an empty array means "none
 * selected" (callers typically treat that as "all"). Rows are <button>s with a
 * faux checkbox (a Check icon in a styled span) so we never nest a Radix
 * Checkbox <button> inside the row button.
 */
export function MultiSelect<T>({
  options,
  value,
  onChange,
  getOptionValue,
  getOptionLabel,
  placeholder = 'All',
  searchPlaceholder = 'Search…',
  emptyLabel = 'No results',
  summarize,
  disabled,
  className,
  triggerClassName,
}: MultiSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  // Clear the search box whenever the popover closes.
  useEffect(() => {
    if (!open) setSearch('');
  }, [open]);

  const selectedSet = useMemo(() => new Set(value), [value]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => getOptionLabel(o).toLowerCase().includes(q));
  }, [options, search, getOptionLabel]);

  const triggerLabel = (() => {
    if (value.length === 0) return placeholder;
    if (value.length === 1) {
      const only = options.find((o) => getOptionValue(o) === value[0]);
      if (only) return getOptionLabel(only);
    }
    return summarize ? summarize(value.length) : `${value.length} selected`;
  })();

  const toggle = (val: string) => {
    if (selectedSet.has(val)) {
      onChange(value.filter((v) => v !== val));
    } else {
      onChange([...value, val]);
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
            value.length === 0 && 'text-muted-foreground',
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
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            autoFocus
          />
        </div>
        <div
          role="listbox"
          aria-multiselectable
          className="max-h-[240px] overflow-y-auto scrollbar-hide py-1 overscroll-contain"
          onWheel={(e) => e.stopPropagation()}
        >
          {/* Reset row — clears the selection (i.e. show everything). */}
          <button
            type="button"
            onClick={() => onChange([])}
            className={cn(
              'flex w-full items-center px-3 py-2 text-left text-sm hover:bg-accent',
              value.length === 0 && 'bg-accent/50'
            )}
          >
            <Check
              className={cn(
                'mr-2 h-4 w-4 shrink-0',
                value.length === 0 ? 'opacity-100' : 'opacity-0'
              )}
            />
            <span className="truncate text-muted-foreground">{placeholder}</span>
          </button>
          {filtered.length === 0 ? (
            <div className="px-3 py-4 text-center text-sm text-muted-foreground">
              {emptyLabel}
            </div>
          ) : (
            filtered.map((item) => {
              const val = getOptionValue(item);
              const checked = selectedSet.has(val);
              return (
                <button
                  key={val}
                  type="button"
                  role="option"
                  aria-selected={checked}
                  onClick={() => toggle(val)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                >
                  <span
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border',
                      checked
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-input'
                    )}
                  >
                    {checked && <Check className="h-3 w-3" />}
                  </span>
                  <span className="truncate">{getOptionLabel(item)}</span>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
