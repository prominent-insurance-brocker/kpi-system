'use client';

/**
 * NumberInput — a numeric text field that renders a live thousands separator
 * (e.g. typing `100000` shows `100,000`) while keeping the value the parent
 * stores comma-free (`"100000"`), so `Number(value)` keeps working on submit.
 *
 * Why `type="text"` and not `type="number"`: browsers refuse to render commas
 * (or any non-numeric character) inside `<input type="number">`, so live
 * grouping is impossible there. We use a text input with `inputMode="decimal"`
 * to still surface a numeric keypad on mobile.
 *
 * The caret is preserved across re-formatting by counting the digit/decimal
 * characters to the left of the cursor and restoring that position after the
 * commas shift.
 */

import * as React from 'react';

import { Input } from '@/components/ui/input';

/** Keep only digits and a single decimal point. */
function sanitizeRaw(input: string): string {
  let s = input.replace(/[^\d.]/g, '');
  const firstDot = s.indexOf('.');
  if (firstDot !== -1) {
    s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, '');
  }
  return s;
}

/**
 * Group the integer part in threes, preserving the decimal portion (and any
 * in-progress trailing dot) exactly as typed. Leading zeros are trimmed.
 */
function formatWithCommas(raw: string): string {
  if (raw === '') return '';
  const hasDot = raw.includes('.');
  const [intRaw, decRaw = ''] = raw.split('.');
  const intPart = intRaw.replace(/^0+(?=\d)/, '');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return hasDot ? `${grouped}.${decRaw}` : grouped;
}

/** Count the "significant" (digit or dot) characters in a string. */
function countSignificant(s: string): number {
  return (s.match(/[\d.]/g) ?? []).length;
}

/** Caret index in `display` that sits just after `n` significant characters. */
function caretForSignificant(display: string, n: number): number {
  if (n <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < display.length; i++) {
    if (/[\d.]/.test(display[i])) {
      seen += 1;
      if (seen === n) return i + 1;
    }
  }
  return display.length;
}

export interface NumberInputProps
  extends Omit<React.ComponentProps<'input'>, 'value' | 'onChange' | 'type'> {
  /** Raw, comma-free numeric string (e.g. "100000" or "1500.50"). */
  value: string;
  /** Called with the raw, comma-free string on every edit. */
  onValueChange: (raw: string) => void;
}

export function NumberInput({
  value,
  onValueChange,
  inputMode,
  ...props
}: NumberInputProps) {
  // The live <input> element, captured from the change event so the caret can
  // be restored without forwarding a ref into the Input primitive.
  const elRef = React.useRef<HTMLInputElement | null>(null);
  const caretRef = React.useRef<number | null>(null);
  const [display, setDisplay] = React.useState(() => formatWithCommas(value ?? ''));

  // Re-sync the local display when the external value changes for reasons other
  // than typing here (prefill on edit, form reset, programmatic clear).
  React.useEffect(() => {
    const ext = value ?? '';
    if (sanitizeRaw(display) !== ext) setDisplay(formatWithCommas(ext));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Restore the caret after React commits the re-formatted display.
  React.useLayoutEffect(() => {
    if (caretRef.current != null && elRef.current) {
      const pos = caretRef.current;
      caretRef.current = null;
      elRef.current.setSelectionRange(pos, pos);
    }
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    elRef.current = e.currentTarget;
    const typed = e.currentTarget.value;
    const caret = e.currentTarget.selectionStart ?? typed.length;
    const significantBefore = countSignificant(typed.slice(0, caret));

    const raw = sanitizeRaw(typed);
    const next = formatWithCommas(raw);

    caretRef.current = caretForSignificant(next, significantBefore);
    setDisplay(next);
    onValueChange(raw);
  };

  return (
    <Input
      {...props}
      type="text"
      inputMode={inputMode ?? 'decimal'}
      value={display}
      onChange={handleChange}
    />
  );
}
