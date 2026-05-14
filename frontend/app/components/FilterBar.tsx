"use client";

import { useCallback } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { DateRangeFilter } from "@/components/ui/date-range-filter";
import { getUsersForModulePage } from "@/app/lib/api";

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
      {presetDateRange && (
        <>
          <div className="flex flex-col gap-2">
            <Label>{presetDateRange.label}</Label>
            <Select
              value={presetDateRange.preset || "any"}
              onValueChange={(v) =>
                presetDateRange.onPresetChange(v === "any" ? "" : v)
              }
            >
              <SelectTrigger className="w-[200px] shadow-none">
                <SelectValue placeholder={presetDateRange.placeholder ?? "Any"} />
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
          </div>
          {presetDateRange.preset === "custom" && (
            <div className="flex flex-col gap-2">
              <Label>{presetDateRange.label} range</Label>
              <DateRangeFilter
                dateFrom={presetDateRange.customFrom}
                dateTo={presetDateRange.customTo}
                onChange={presetDateRange.onCustomChange}
              />
            </div>
          )}
        </>
      )}
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
