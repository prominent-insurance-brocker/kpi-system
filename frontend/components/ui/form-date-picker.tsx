"use client"

import * as React from "react"
import { CalendarIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

interface FormDatePickerProps {
  label?: string
  value: string // YYYY-MM-DD format
  onChange: (date: string) => void
  required?: boolean
  className?: string
}

export function FormDatePicker({
  label,
  value,
  onChange,
  required,
  className,
}: FormDatePickerProps) {
  const [open, setOpen] = React.useState(false)

  // Parse the value string to a Date object
  const selectedDate = value ? new Date(value + "T00:00:00") : undefined

  const handleSelect = (date: Date | undefined) => {
    if (date) {
      // Format to YYYY-MM-DD
      const formatted = date.toISOString().split("T")[0]
      onChange(formatted)
    } else {
      onChange("")
    }
    setOpen(false)
  }

  const formatDisplayDate = (dateStr: string): string => {
    if (!dateStr) return "Select date"
    const date = new Date(dateStr + "T00:00:00")
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {label && (
        <Label>
          {label}
          {required && <span className="text-destructive ml-1">*</span>}
        </Label>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              "w-full justify-start text-left font-normal",
              !value && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {formatDisplayDate(value)}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={handleSelect}
            defaultMonth={selectedDate || new Date()}
            initialFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
