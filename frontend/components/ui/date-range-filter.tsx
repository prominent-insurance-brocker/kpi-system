"use client"

import * as React from "react"
import { CalendarIcon } from "lucide-react"
import { type DateRange } from "react-day-picker"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { businessToday } from "@/app/lib/date"

interface DateRangeFilterProps {
  dateFrom: string
  dateTo: string
  onChange: (dateFrom: string, dateTo: string) => void
}

// TED-486: preset list standardised across every entry-date filter. The
// motor-claim "Next call date" filter uses a separate FilterBar
// `presetDateRange` control (future-dated follow-ups) and is intentionally
// outside this list.
type PresetKey =
  | "all"
  | "today"
  | "1-day-ago"
  | "3-days-ago"
  | "this-week"
  | "prev-week"
  | "this-month"
  | "prev-month"
  | "custom"

const presets: { key: PresetKey; label: string }[] = [
  { key: "all", label: "All time" },
  { key: "today", label: "Today" },
  { key: "1-day-ago", label: "1 day ago" },
  { key: "3-days-ago", label: "3 days ago" },
  { key: "this-week", label: "This week" },
  { key: "prev-week", label: "Previous week" },
  { key: "this-month", label: "This month" },
  { key: "prev-month", label: "Previous month" },
  { key: "custom", label: "Custom" },
]

const formatDate = (d: Date): string => {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const getDateRange = (preset: PresetKey): { from: string; to: string } => {
  // "Today" et al. resolve against the business day (Asia/Dubai), so the preset
  // ranges line up with how the backend buckets/filters added_at — not the
  // viewer's browser clock.
  const today = businessToday()

  switch (preset) {
    case "today":
      return { from: formatDate(today), to: formatDate(today) }
    case "1-day-ago": {
      // Single-day filter — yesterday only, mirroring "Today".
      const d = new Date(today)
      d.setDate(today.getDate() - 1)
      return { from: formatDate(d), to: formatDate(d) }
    }
    case "3-days-ago": {
      const d = new Date(today)
      d.setDate(today.getDate() - 3)
      return { from: formatDate(d), to: formatDate(d) }
    }
    case "this-week": {
      // Monday-start week. Range ends at today since future entries don't
      // exist; user can still flip to Custom for an explicit Mon–Sun window.
      const start = new Date(today)
      const dayOfWeek = (start.getDay() + 6) % 7 // 0 = Mon … 6 = Sun
      start.setDate(start.getDate() - dayOfWeek)
      return { from: formatDate(start), to: formatDate(today) }
    }
    case "prev-week": {
      // Monday-to-Sunday of the previous calendar week.
      const end = new Date(today)
      const dayOfWeek = (end.getDay() + 6) % 7
      end.setDate(end.getDate() - dayOfWeek - 1) // Sunday of last week
      const start = new Date(end)
      start.setDate(end.getDate() - 6) // Monday of last week
      return { from: formatDate(start), to: formatDate(end) }
    }
    case "this-month": {
      // First of the current month → today (same rationale as this-week).
      const start = new Date(today.getFullYear(), today.getMonth(), 1)
      return { from: formatDate(start), to: formatDate(today) }
    }
    case "prev-month": {
      // First → last day of the previous calendar month. Day 0 of the next
      // month resolves to the last day of the prior month.
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      const end = new Date(today.getFullYear(), today.getMonth(), 0)
      return { from: formatDate(start), to: formatDate(end) }
    }
    default:
      return { from: "", to: "" }
  }
}

const detectPreset = (dateFrom: string, dateTo: string): PresetKey => {
  if (!dateFrom && !dateTo) return "all"

  // Check each preset — order matches the dropdown so a range that satisfies
  // multiple presets resolves to the most specific one declared first.
  for (const preset of [
    "today",
    "1-day-ago",
    "3-days-ago",
    "this-week",
    "prev-week",
    "this-month",
    "prev-month",
  ] as PresetKey[]) {
    const range = getDateRange(preset)
    if (range.from === dateFrom && range.to === dateTo) {
      return preset
    }
  }

  // If dates are set but don't match any preset, it's custom
  if (dateFrom || dateTo) return "custom"

  return "all"
}

const formatDisplayDate = (dateStr: string): string => {
  if (!dateStr) return ""
  const date = new Date(dateStr + "T00:00:00")
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

type PickerMode = "single" | "range"

export function DateRangeFilter({ dateFrom, dateTo, onChange }: DateRangeFilterProps) {
  const [isCalendarOpen, setIsCalendarOpen] = React.useState(false)
  const [tempRange, setTempRange] = React.useState<DateRange | undefined>(undefined)
  const [tempSingle, setTempSingle] = React.useState<Date | undefined>(undefined)
  const [pickerMode, setPickerMode] = React.useState<PickerMode>("range")
  const [isCustomMode, setIsCustomMode] = React.useState(false)
  // TED-507: remember the user's last explicit preset pick so we can render
  // the right label when two presets resolve to the same date range. The
  // canonical example: when today is in a month whose 1st falls on a Monday,
  // "This week" and "This month" both span [1st-of-month, today]. Without
  // this memory, detectPreset returns whichever preset comes first in the
  // loop, which flips the trigger label after the user picks the other one.
  const [lastPick, setLastPick] = React.useState<PresetKey | null>(null)
  const justOpenedRef = React.useRef(false)

  // When the parent clears the filter (props become empty), reset internal
  // custom-mode state so the trigger label drops back to "All Time" and the
  // standalone calendar-icon button hides.
  React.useEffect(() => {
    if (!dateFrom && !dateTo) {
      setIsCustomMode(false)
      setTempRange(undefined)
      setTempSingle(undefined)
      setIsCalendarOpen(false)
      setLastPick(null)
    }
  }, [dateFrom, dateTo])

  // Prefer the user's last explicit pick if its date math still matches the
  // current bounds — covers the tied-range ambiguity above. Otherwise fall
  // through to detection from the dates alone.
  const detectedPreset = detectPreset(dateFrom, dateTo)
  const lastPickStillMatches = (() => {
    if (!lastPick || lastPick === "custom") return false
    const r = getDateRange(lastPick)
    return r.from === dateFrom && r.to === dateTo
  })()
  const currentPreset: PresetKey = isCustomMode
    ? "custom"
    : lastPickStillMatches
      ? (lastPick as PresetKey)
      : detectedPreset

  const handlePresetChange = (value: string) => {
    const preset = value as PresetKey

    if (preset === "custom") {
      // Pick a sensible initial mode based on current values: if from === to
      // (or only one bound is set) default to Single date, else Date range.
      if (dateFrom && dateTo && dateFrom === dateTo) {
        setPickerMode("single")
        setTempSingle(new Date(dateFrom + "T00:00:00"))
        setTempRange(undefined)
      } else if (dateFrom || dateTo) {
        setPickerMode("range")
        setTempRange({
          from: dateFrom ? new Date(dateFrom + "T00:00:00") : undefined,
          to: dateTo ? new Date(dateTo + "T00:00:00") : undefined,
        })
        setTempSingle(undefined)
      } else {
        setPickerMode("range")
        setTempRange(undefined)
        setTempSingle(undefined)
      }
      setIsCustomMode(true)
      // Mark that we're about to open, so onOpenChange doesn't immediately close
      justOpenedRef.current = true
      // Delay to ensure the PopoverTrigger button is rendered first
      setTimeout(() => {
        setIsCalendarOpen(true)
        // Reset the flag after a short delay
        setTimeout(() => {
          justOpenedRef.current = false
        }, 100)
      }, 50)
    } else {
      setIsCustomMode(false)
      // TED-507: remember the explicit pick so the trigger label keeps
      // showing what the user chose even when another preset's range ties.
      setLastPick(preset)
      const range = getDateRange(preset)
      onChange(range.from, range.to)
    }
  }

  const handleOpenChange = (open: boolean) => {
    // Prevent closing if we just opened
    if (!open && justOpenedRef.current) {
      return
    }
    setIsCalendarOpen(open)
    // Reset custom mode if closing without custom dates applied
    if (!open && isCustomMode && detectedPreset !== "custom") {
      setIsCustomMode(false)
    }
  }

  const handleRangeSelect = (range: DateRange | undefined) => {
    setTempRange(range)
  }

  const handleSingleSelect = (date: Date | undefined) => {
    setTempSingle(date)
  }

  const handleModeChange = (mode: PickerMode) => {
    if (mode === pickerMode) return
    // Carry the current selection across modes when sensible so switching
    // doesn't always wipe the user's pick.
    if (mode === "single") {
      // From range → single: take the start date if there is one.
      setTempSingle(tempRange?.from ?? tempSingle)
    } else {
      // From single → range: seed range.from with the single date.
      if (tempSingle && !tempRange) {
        setTempRange({ from: tempSingle, to: undefined })
      }
    }
    setPickerMode(mode)
  }

  const handleApply = () => {
    if (pickerMode === "single") {
      const ds = tempSingle ? formatDate(tempSingle) : ""
      // Single-date mode filters to that exact day (from = to = day).
      onChange(ds, ds)
    } else {
      const from = tempRange?.from ? formatDate(tempRange.from) : ""
      const to = tempRange?.to ? formatDate(tempRange.to) : ""
      onChange(from, to)
    }
    setIsCalendarOpen(false)
  }

  const handleClear = () => {
    setTempRange(undefined)
    setTempSingle(undefined)
    onChange("", "")
    setIsCalendarOpen(false)
    setIsCustomMode(false)
  }

  const getDisplayText = (): string => {
    if (detectedPreset === "custom" && (dateFrom || dateTo)) {
      const from = formatDisplayDate(dateFrom)
      const to = formatDisplayDate(dateTo)
      // Same-day filter — show as a single date instead of "X - X".
      if (from && to && dateFrom === dateTo) return from
      if (from && to) return `${from} - ${to}`
      if (from) return `From ${from}`
      if (to) return `To ${to}`
    }
    return presets.find((p) => p.key === currentPreset)?.label || "All time"
  }

  const showCustomButton = currentPreset === "custom" || isCustomMode

  // Apply button enablement — require a value matching the active mode.
  const canApply =
    pickerMode === "single"
      ? !!tempSingle
      : !!(tempRange?.from || tempRange?.to)

  return (
    <div className="flex items-center gap-2">
      <Popover open={isCalendarOpen} onOpenChange={handleOpenChange}>
        <div className="flex items-center gap-2">
          <Select value={currentPreset} onValueChange={handlePresetChange}>
            <SelectTrigger className="min-w-[180px] w-fit shadow-none">
              <div className="flex items-center gap-2 pointer-events-none">
                <CalendarIcon className="h-4 w-4 flex-shrink-0" />
                <SelectValue className="whitespace-nowrap">{getDisplayText()}</SelectValue>
              </div>
            </SelectTrigger>
            <SelectContent>
              {presets.map((preset) => (
                <SelectItem key={preset.key} value={preset.key}>
                  {preset.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {showCustomButton && (
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className={cn(
                  "h-9 w-9",
                  isCalendarOpen && "bg-accent"
                )}
              >
                <CalendarIcon className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
          )}
        </div>

        <PopoverContent className="w-auto p-0" align="start">
          <div className="p-3">
            {/* Mode toggle — single date vs date range */}
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
                defaultMonth={tempSingle || businessToday()}
                selected={tempSingle}
                onSelect={handleSingleSelect}
                numberOfMonths={1}
                className="rounded-md border-0"
              />
            ) : (
              <Calendar
                mode="range"
                defaultMonth={tempRange?.from || businessToday()}
                selected={tempRange}
                onSelect={handleRangeSelect}
                numberOfMonths={2}
                className="rounded-md border-0"
              />
            )}

            <div className="flex justify-end gap-2 pt-3 border-t mt-3">
              <Button variant="outline" size="sm" onClick={handleClear}>
                Clear
              </Button>
              <Button size="sm" onClick={handleApply} disabled={!canApply}>
                Apply
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
