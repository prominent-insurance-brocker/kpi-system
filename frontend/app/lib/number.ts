/**
 * Number formatting utilities.
 *
 * The app serves a UAE-based insurance business, so all monetary and numeric
 * values render in UAE / international style: a thousands separator every 3
 * digits with a "." decimal point (e.g. 500,000.00, 1,000,000.00) — NOT the
 * Indian lakh grouping (5,00,000.00).
 *
 * 'en-AE' yields Latin digits with comma grouping, identical to 'en-US'.
 * (Do not use 'ar-AE', which would render Arabic-Indic digits.)
 */

const NUMBER_LOCALE = 'en-AE';

/**
 * Format a monetary / premium value, always with 2 decimal places.
 * Example: 500000 -> "500,000.00", "1000000" -> "1,000,000.00"
 */
export function formatPremium(val: number | string | null | undefined): string {
  if (val == null || val === '') return '0.00';
  const n = Number(val);
  if (!Number.isFinite(n)) return '0.00';
  return n.toLocaleString(NUMBER_LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Format a plain count / integer with thousands grouping and no decimals.
 * Example: 1500 -> "1,500"
 */
export function formatNumber(val: number | string | null | undefined): string {
  if (val == null || val === '') return '0';
  const n = Number(val);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString(NUMBER_LOCALE, {
    maximumFractionDigits: 0,
  });
}
