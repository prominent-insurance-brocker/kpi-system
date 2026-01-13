"use client"

import * as React from "react"
import { CalendarIcon, ChevronDownIcon } from "lucide-react"
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

interface DateRangeFilterProps {
  dateFrom: string
  dateTo: string
  onChange: (dateFrom: string, dateTo: string) => void
}

type PresetKey = "all" | "today" | "last-week" | "last-two-weeks" | "last-month" | "custom"

const presets: { key: PresetKey; label: string }[] = [
  { key: "all", label: "All Time" },
  { key: "today", label: "Today" },
  { key: "last-week", label: "Last Week" },
  { key: "last-two-weeks", label: "Last Two Weeks" },
  { key: "last-month", label: "Last Month" },
  { key: "custom", label: "Custom" },
]

const formatDate = (d: Date): string => {
  return d.toISOString().split("T")[0]
}

const getDateRange = (preset: PresetKey): { from: string; to: string } => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  switch (preset) {
    case "today":
      return { from: formatDate(today), to: formatDate(today) }
    case "last-week": {
      const weekAgo = new Date(today)
      weekAgo.setDate(today.getDate() - 7)
      return { from: formatDate(weekAgo), to: formatDate(today) }
    }
    case "last-two-weeks": {
      const twoWeeksAgo = new Date(today)
      twoWeeksAgo.setDate(today.getDate() - 14)
      return { from: formatDate(twoWeeksAgo), to: formatDate(today) }
    }
    case "last-month": {
      const monthAgo = new Date(today)
      monthAgo.setDate(today.getDate() - 30)
      return { from: formatDate(monthAgo), to: formatDate(today) }
    }
    default:
      return { from: "", to: "" }
  }
}

const detectPreset = (dateFrom: string, dateTo: string): PresetKey => {
  if (!dateFrom && !dateTo) return "all"

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayStr = formatDate(today)

  // Check each preset
  for (const preset of ["today", "last-week", "last-two-weeks", "last-month"] as PresetKey[]) {
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
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export function DateRangeFilter({ dateFrom, dateTo, onChange }: DateRangeFilterProps) {
  const [isCalendarOpen, setIsCalendarOpen] = React.useState(false)
  const [tempRange, setTempRange] = React.useState<DateRange | undefined>(undefined)

  const currentPreset = detectPreset(dateFrom, dateTo)

  const handlePresetChange = (value: string) => {
    const preset = value as PresetKey

    if (preset === "custom") {
      // Initialize temp range with current values or undefined
      if (dateFrom || dateTo) {
        setTempRange({
          from: dateFrom ? new Date(dateFrom + "T00:00:00") : undefined,
          to: dateTo ? new Date(dateTo + "T00:00:00") : undefined,
        })
      } else {
        setTempRange(undefined)
      }
      setIsCalendarOpen(true)
    } else {
      const range = getDateRange(preset)
      onChange(range.from, range.to)
    }
  }

  const handleCalendarSelect = (range: DateRange | undefined) => {
    setTempRange(range)
  }

  const handleApply = () => {
    const from = tempRange?.from ? formatDate(tempRange.from) : ""
    const to = tempRange?.to ? formatDate(tempRange.to) : ""
    onChange(from, to)
    setIsCalendarOpen(false)
  }

  const handleClear = () => {
    setTempRange(undefined)
    onChange("", "")
    setIsCalendarOpen(false)
  }

  const getDisplayText = (): string => {
    if (currentPreset === "custom" && (dateFrom || dateTo)) {
      const from = formatDisplayDate(dateFrom)
      const to = formatDisplayDate(dateTo)
      if (from && to) return `${from} - ${to}`
      if (from) return `From ${from}`
      if (to) return `To ${to}`
    }
    return presets.find((p) => p.key === currentPreset)?.label || "All Time"
  }

  return (
    <div className="flex items-center gap-2">
      <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
        <div className="flex items-center gap-2">
          <Select value={currentPreset} onValueChange={handlePresetChange}>
            <SelectTrigger className="w-[180px]">
              <CalendarIcon className="mr-2 h-4 w-4" />
              <SelectValue>{getDisplayText()}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {presets.map((preset) => (
                <SelectItem key={preset.key} value={preset.key}>
                  {preset.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {currentPreset === "custom" && (
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
            <Calendar
              mode="range"
              defaultMonth={tempRange?.from || new Date()}
              selected={tempRange}
              onSelect={handleCalendarSelect}
              numberOfMonths={2}
              className="rounded-md border-0"
            />
            <div className="flex justify-end gap-2 pt-3 border-t mt-3">
              <Button variant="outline" size="sm" onClick={handleClear}>
                Clear
              </Button>
              <Button size="sm" onClick={handleApply}>
                Apply
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
