"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarIcon, Search } from "lucide-react";
import { type DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { DateRangeFilter } from "@/components/ui/date-range-filter";
import { cn } from "@/lib/utils";
import { getUsersForModulePage } from "@/app/lib/api";
// (FormDatePicker import removed — replaced by the inline CustomRangePopover
// below so the Custom branch matches Entry-date's single-trigger calendar UX.)

// Single-trigger range picker used for the presetDateRange's Custom branch.
// Mirrors the visual format of the Entry-date DateRangeFilter's Custom popover:
// icon-only trigger button → popover with "Single date | Date range" toggle,
// 2-month calendar, and Clear/Apply buttons. Keeps both filters on the same
// row visually consistent.
type PickerMode = "single" | "range";

function CustomRangePopover({
  from,
  to,
  onChange,
  autoOpenToken,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  // Parent bumps this counter to request that the popover open itself —
  // e.g. when the user picks "Custom" in the preset Select alongside.
  autoOpenToken?: number;
}) {
  const [open, setOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<PickerMode>("range");
  const [tempRange, setTempRange] = useState<DateRange | undefined>(undefined);
  const [tempSingle, setTempSingle] = useState<Date | undefined>(undefined);

  // Auto-open when the parent's signal increments. We guard against the
  // initial render (token=0) so the popover doesn't pop up on page load.
  useEffect(() => {
    if (autoOpenToken && autoOpenToken > 0) {
      // tiny delay so the trigger button has mounted (mirrors the pattern
      // used inside DateRangeFilter for the same scenario).
      const t = setTimeout(() => setOpen(true), 50);
      return () => clearTimeout(t);
    }
  }, [autoOpenToken]);

  const fmt = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  const parse = (s: string) => (s ? new Date(s + "T00:00:00") : undefined);

  // Seed the picker with the externally-set range each time it opens, and
  // default to Single-date mode if the existing values are a same-day filter.
  useEffect(() => {
    if (!open) return;
    if (from && to && from === to) {
      setPickerMode("single");
      setTempSingle(parse(from));
      setTempRange(undefined);
    } else {
      setPickerMode("range");
      setTempRange({ from: parse(from), to: parse(to) });
      setTempSingle(undefined);
    }
  }, [open, from, to]);

  const handleModeChange = (mode: PickerMode) => {
    if (mode === pickerMode) return;
    // Carry the current pick across modes when sensible.
    if (mode === "single") {
      setTempSingle(tempRange?.from ?? tempSingle);
    } else if (tempSingle && !tempRange) {
      setTempRange({ from: tempSingle, to: undefined });
    }
    setPickerMode(mode);
  };

  const canApply =
    pickerMode === "single" ? !!tempSingle : !!(tempRange?.from || tempRange?.to);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className={cn("h-9 w-9 shadow-none", open && "bg-accent")}
          aria-label="Pick custom date range"
        >
          <CalendarIcon className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="p-3">
          {/* Mode toggle — single date vs date range, same as DateRangeFilter */}
          <div className="inline-flex items-center rounded-md border border-[#E4E4E4] p-0.5 mb-3 text-xs font-medium">
            <button
              type="button"
              onClick={() => handleModeChange("single")}
              className={cn(
                "px-3 py-1 rounded-sm transition-colors",
                pickerMode === "single"
                  ? "bg-[#09090B] text-white"
                  : "text-[#71717A] hover:text-[#09090B]"
              )}
            >
              Single date
            </button>
            <button
              type="button"
              onClick={() => handleModeChange("range")}
              className={cn(
                "px-3 py-1 rounded-sm transition-colors",
                pickerMode === "range"
                  ? "bg-[#09090B] text-white"
                  : "text-[#71717A] hover:text-[#09090B]"
              )}
            >
              Date range
            </button>
          </div>

          {pickerMode === "single" ? (
            <Calendar
              mode="single"
              defaultMonth={tempSingle || new Date()}
              selected={tempSingle}
              onSelect={setTempSingle}
              numberOfMonths={1}
              className="rounded-md border-0"
            />
          ) : (
            <Calendar
              mode="range"
              defaultMonth={tempRange?.from || new Date()}
              selected={tempRange}
              onSelect={setTempRange}
              numberOfMonths={2}
              className="rounded-md border-0"
            />
          )}

          <div className="flex justify-end gap-2 pt-3 border-t mt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setTempRange(undefined);
                setTempSingle(undefined);
                onChange("", "");
                setOpen(false);
              }}
            >
              Clear
            </Button>
            <Button
              size="sm"
              disabled={!canApply}
              onClick={() => {
                if (pickerMode === "single") {
                  // Single-date mode filters to that exact day (from = to).
                  const ds = tempSingle ? fmt(tempSingle) : "";
                  onChange(ds, ds);
                } else {
                  onChange(
                    tempRange?.from ? fmt(tempRange.from) : "",
                    tempRange?.to ? fmt(tempRange.to) : ""
                  );
                }
                setOpen(false);
              }}
            >
              Apply
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export type FilterBarOption = { value: string; label: string };

export interface FilterBarProps {
  search?: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    label?: string;
  };
  dateRange?: {
    from: string;
    to: string;
    onChange: (from: string, to: string) => void;
    label?: string;
  };
  secondaryDateRange?: {
    from: string;
    to: string;
    onChange: (from: string, to: string) => void;
    label: string;
  };
  user?: {
    value: string;
    onChange: (value: string) => void;
    // Drives server-side search + infinite scroll via /module-members/.
    moduleKey: string;
    // Optional precomputed label to display in the trigger when `value` is
    // set but the user hasn't opened the dropdown yet (e.g., on page reload
    // with a sticky filter). Falls back to the placeholder otherwise.
    selectedLabel?: string | null;
    placeholder?: string;
  };
  agent?: {
    value: string;
    onChange: (value: string) => void;
    moduleKey?: string; // defaults to 'sales_kpi'
    selectedLabel?: string | null;
    placeholder?: string;
    label?: string;
  };
  status?: {
    value: string;
    onChange: (value: string) => void;
    options: FilterBarOption[];
    placeholder?: string;
  };
  // Preset selector for date-range filters (e.g. Motor Claim's "Next call
  // date"). When `preset === 'custom'` the embedded date range picker is
  // shown alongside; for other presets the page is responsible for
  // computing the actual from/to bounds.
  presetDateRange?: {
    label: string;
    preset: string;
    onPresetChange: (preset: string) => void;
    options: FilterBarOption[]; // first option is treated as "any" (no filter)
    customFrom: string;
    customTo: string;
    onCustomChange: (from: string, to: string) => void;
    placeholder?: string;
  };
  // Generic searchable+paginated filters. Each entry renders a SearchableSelect
  // with its own async fetcher — used today for Type of Accident / Insurance
  // Company on the Motor Claim page.
  extraSearchableFilters?: Array<{
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    clearLabel?: string;
    selectedLabel?: string | null;
    width?: string;
    fetchPage: (params: { search: string; page: number }) => Promise<{
      results: Array<{ id: number; name: string }>;
      hasMore: boolean;
    }>;
  }>;
  onClear?: () => void;
  hasActiveFilters?: boolean;
}

export function FilterBar({
  search,
  dateRange,
  secondaryDateRange,
  user,
  agent,
  status,
  presetDateRange,
  extraSearchableFilters,
  onClear,
  hasActiveFilters,
}: FilterBarProps) {
  // Bumped each time the user picks "Custom" in the preset Select so the
  // sibling CustomRangePopover auto-opens, matching DateRangeFilter's UX.
  const [customAutoOpenToken, setCustomAutoOpenToken] = useState(0);
  const userModuleKey = user?.moduleKey;
  const userFetchPage = useCallback(
    async ({ search: q, page }: { search: string; page: number }) => {
      if (!userModuleKey) return { results: [], hasMore: false };
      const res = await getUsersForModulePage(userModuleKey, { search: q, page });
      return {
        results: res.data?.results ?? [],
        hasMore: res.data?.has_more ?? false,
      };
    },
    [userModuleKey]
  );

  const agentModuleKey = agent?.moduleKey ?? "sales_kpi";
  const agentFetchPage = useCallback(
    async ({ search: q, page }: { search: string; page: number }) => {
      const res = await getUsersForModulePage(agentModuleKey, { search: q, page });
      return {
        results: res.data?.results ?? [],
        hasMore: res.data?.has_more ?? false,
      };
    },
    [agentModuleKey]
  );

  return (
    <div className="flex gap-4 items-end flex-wrap">
      {search && (
        <div className="flex flex-col gap-2">
          <Label>{search.label ?? "Search"}</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF] pointer-events-none" />
            <Input
              type="search"
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              placeholder={search.placeholder ?? "Search…"}
              className="w-[240px] pl-8 shadow-none"
            />
          </div>
        </div>
      )}
      {dateRange && (
        <div className="flex flex-col gap-2">
          <Label>{dateRange.label ?? "Date Range"}</Label>
          <DateRangeFilter
            dateFrom={dateRange.from}
            dateTo={dateRange.to}
            onChange={dateRange.onChange}
          />
        </div>
      )}
      {secondaryDateRange && (
        <div className="flex flex-col gap-2">
          <Label>{secondaryDateRange.label}</Label>
          <DateRangeFilter
            dateFrom={secondaryDateRange.from}
            dateTo={secondaryDateRange.to}
            onChange={secondaryDateRange.onChange}
          />
        </div>
      )}
      {presetDateRange && (() => {
        // When Custom is active and a range has been picked, show the dates as
        // the Select's display label (matching DateRangeFilter's behavior).
        const fmtDisplay = (s: string) => {
          if (!s) return "";
          const d = new Date(s + "T00:00:00");
          return d.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          });
        };
        const cf = presetDateRange.customFrom;
        const ct = presetDateRange.customTo;
        const customDisplay =
          presetDateRange.preset === "custom" && (cf || ct)
            ? cf && ct && cf === ct
              ? fmtDisplay(cf)
              : cf && ct
                ? `${fmtDisplay(cf)} - ${fmtDisplay(ct)}`
                : cf
                  ? `From ${fmtDisplay(cf)}`
                  : `To ${fmtDisplay(ct)}`
            : null;

        return (
          <div className="flex flex-col gap-2">
            <Label>{presetDateRange.label}</Label>
            <div className="flex items-center gap-2">
              <Select
                value={presetDateRange.preset || "any"}
                onValueChange={(v) => {
                  presetDateRange.onPresetChange(v === "any" ? "" : v);
                  if (v === "custom") {
                    setCustomAutoOpenToken((t) => t + 1);
                  }
                }}
              >
                <SelectTrigger className="min-w-[180px] w-fit shadow-none">
                  <SelectValue placeholder={presetDateRange.placeholder ?? "Any"}>
                    {customDisplay ?? undefined}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any</SelectItem>
                  {presetDateRange.options.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {presetDateRange.preset === "custom" && (
                <CustomRangePopover
                  from={presetDateRange.customFrom}
                  to={presetDateRange.customTo}
                  onChange={presetDateRange.onCustomChange}
                  autoOpenToken={customAutoOpenToken}
                />
              )}
            </div>
          </div>
        );
      })()}
      {user && (
        <div className="flex flex-col gap-2">
          <Label>User</Label>
          <div className="w-[200px]">
            <SearchableSelect
              value={user.value || null}
              onValueChange={(v) => user.onChange(v)}
              placeholder={user.placeholder ?? "All Users"}
              clearLabel="All Users"
              selectedLabel={user.selectedLabel ?? null}
              getOptionValue={(u) => String(u.id)}
              getOptionLabel={(u) => u.full_name || u.email}
              fetchPage={userFetchPage}
              emptyLabel="No users found"
            />
          </div>
        </div>
      )}
      {agent && (
        <div className="flex flex-col gap-2">
          <Label>{agent.label ?? "Agent"}</Label>
          <div className="w-[200px]">
            <SearchableSelect
              value={agent.value || null}
              onValueChange={(v) => agent.onChange(v)}
              placeholder={agent.placeholder ?? "All Agents"}
              clearLabel="All Agents"
              selectedLabel={agent.selectedLabel ?? null}
              getOptionValue={(u) => String(u.id)}
              getOptionLabel={(u) => u.full_name || u.email}
              fetchPage={agentFetchPage}
              emptyLabel="No agents found"
            />
          </div>
        </div>
      )}
      {status && (
        <div className="flex flex-col gap-2">
          <Label>Status</Label>
          <Select
            value={status.value || "all"}
            onValueChange={(v) => status.onChange(v === "all" ? "" : v)}
          >
            <SelectTrigger className="w-[200px] shadow-none">
              <SelectValue placeholder={status.placeholder ?? "All Statuses"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {status.options.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {extraSearchableFilters?.map((f) => (
        <div key={f.label} className="flex flex-col gap-2">
          <Label>{f.label}</Label>
          <div className={f.width ?? "w-[200px]"}>
            <SearchableSelect
              value={f.value || null}
              onValueChange={(v) => f.onChange(v)}
              placeholder={f.placeholder ?? `All ${f.label}`}
              clearLabel={f.clearLabel ?? `All ${f.label}`}
              selectedLabel={f.selectedLabel ?? null}
              getOptionValue={(o) => String(o.id)}
              getOptionLabel={(o) => o.name}
              fetchPage={f.fetchPage}
              emptyLabel={`No ${f.label.toLowerCase()} found`}
            />
          </div>
        </div>
      ))}
      {hasActiveFilters && onClear && (
        <Button variant="outline" onClick={onClear}>
          Clear Filters
        </Button>
      )}
    </div>
  );
}
