import type { Currency } from "./types";

/** Money, no cents — every amount in this product is a round settlement figure. */
export function money(amount: number, currency?: Currency): string {
  const formatted = amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
  return currency ? `${formatted.replace("$", "")} ${currency}` : formatted;
}

export function percent(value: number): string {
  return `${value.toFixed(2)}%`;
}

/** ISO date to "30 Sep 2029". UTC throughout, so no off-by-one from local time. */
export function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** ISO date to "Sep 2029". */
export function monthYear(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Middle-truncate a hash or address for display: 0x8f3c1a…5d8a2b */
export function truncateHex(value: string, lead = 8, tail = 6): string {
  if (value.length <= lead + tail + 1) return value;
  return `${value.slice(0, lead)}…${value.slice(-tail)}`;
}

export function confidencePct(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

