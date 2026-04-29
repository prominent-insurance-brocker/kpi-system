"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DateRangeFilter } from "@/components/ui/date-range-filter";

export type FilterBarOption = { value: string; label: string };

export interface FilterBarProps {
  dateRange?: {
    from: string;
    to: string;
    onChange: (from: string, to: string) => void;
  };
  user?: {
    value: string;
    onChange: (value: string) => void;
    options: FilterBarOption[];
    placeholder?: string;
  };
  status?: {
    value: string;
    onChange: (value: string) => void;
    options: FilterBarOption[];
    placeholder?: string;
  };
  onClear?: () => void;
  hasActiveFilters?: boolean;
}

export function FilterBar({ dateRange, user, status, onClear, hasActiveFilters }: FilterBarProps) {
  return (
    <div className="flex gap-4 items-end flex-wrap">
      {dateRange && (
        <div className="flex flex-col gap-2">
          <Label>Date Range</Label>
          <DateRangeFilter
            dateFrom={dateRange.from}
            dateTo={dateRange.to}
            onChange={dateRange.onChange}
          />
        </div>
      )}
      {user && (
        <div className="flex flex-col gap-2">
          <Label>User</Label>
          <Select
            value={user.value || "all"}
            onValueChange={(v) => user.onChange(v === "all" ? "" : v)}
          >
            <SelectTrigger className="w-[200px] shadow-none">
              <SelectValue placeholder={user.placeholder ?? "All Users"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Users</SelectItem>
              {user.options.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
      {hasActiveFilters && onClear && (
        <Button variant="outline" onClick={onClear}>
          Clear Filters
        </Button>
      )}
    </div>
  );
}
