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

/**
 * Parses either shape this app holds dates in.
 *
 * Extracted terms carry a bare `YYYY-MM-DD`, which has to be pinned to UTC or
 * a browser west of Greenwich renders the day before. Database columns carry a
 * full timestamp, which is already unambiguous — and appending the time to one
 * of those produced `...123ZT00:00:00Z` and an Invalid Date on screen, which is
 * how the admin queue came to report every decision as undated.
 */
function parseDate(iso: string): Date {
  return new Date(iso.includes("T") ? iso : `${iso}T00:00:00Z`);
}

/** ISO date to "30 Sep 2029". UTC throughout, so no off-by-one from local time. */
export function shortDate(iso: string): string {
  const date = parseDate(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** ISO date to "Sep 2029". */
export function monthYear(iso: string): string {
  const date = parseDate(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", {
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

