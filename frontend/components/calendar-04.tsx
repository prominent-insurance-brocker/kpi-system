"use client"

import * as React from "react"
import { type DateRange } from "react-day-picker"

import { Calendar } from "@/components/ui/calendar"

interface DateRangeCalendarProps {
  dateRange?: DateRange
  onSelect?: (range: DateRange | undefined) => void
  numberOfMonths?: number
  className?: string
}

export default function Calendar04({
  dateRange: controlledRange,
  onSelect,
  numberOfMonths = 1,
  className = "rounded-lg border shadow-sm",
}: DateRangeCalendarProps) {
  const [internalRange, setInternalRange] = React.useState<DateRange | undefined>({
    from: new Date(2025, 5, 9),
    to: new Date(2025, 5, 26),
  })

  const dateRange = controlledRange !== undefined ? controlledRange : internalRange
  const handleSelect = onSelect || setInternalRange

  return (
    <Calendar
      mode="range"
      defaultMonth={dateRange?.from || new Date()}
      selected={dateRange}
      onSelect={handleSelect}
      numberOfMonths={numberOfMonths}
      className={className}
    />
  )
}
