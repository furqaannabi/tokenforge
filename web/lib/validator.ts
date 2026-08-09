/**
 * The deterministic validator.
 *
 * Rules, not AI. This runs on the extracted values alone and ignores confidence
 * entirely: a term set the model was 99% sure about still fails if the schedule
 * doesn't reproduce the stated rate. Any blocking issue makes the terms
 * unmintable, so the contract never receives numbers that were never checked.
 *
 * Confidence is handled separately, by `reviewGate` below — a field can be
 * arithmetically consistent and still too uncertain to mint without a human
 * signing off on it.
 */

import {
  CURRENCIES,
  DAY_COUNTS,
  PAYMENT_FREQUENCIES,
  PERIODS_PER_YEAR,
  type Currency,
  type DayCount,
  type ExtractedTerms,
  type PaymentPeriod,
  type TermField,
} from "./types";

/** Fields at or below this confidence must be confirmed by a human before minting. */
export const LOW_CONFIDENCE_THRESHOLD = 0.9;

/** Coupon math tolerance, as a fraction of the computed interest. */
const INTEREST_TOLERANCE = 0.01;

/** Rates outside this band are treated as extraction failures, not exotic loans. */
const MIN_RATE_PCT = 0;
const MAX_RATE_PCT = 40;

export interface ValidationIssue {
  field: TermField;
  /** `blocking` prevents minting outright. `warning` is surfaced but mintable. */
  severity: "blocking" | "warning";
  message: string;
}

export interface ValidationResult {
  issues: ValidationIssue[];
  /** True when no blocking issue was found. Confidence is not considered here. */
  consistent: boolean;
}

// ---------------------------------------------------------------------------
// Day-count conventions
// ---------------------------------------------------------------------------

function parseISO(date: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function actualDays(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

/** US (NASD) 30/360. */
function days360(start: Date, end: Date): number {
  const y1 = start.getUTCFullYear();
  const m1 = start.getUTCMonth() + 1;
  const y2 = end.getUTCFullYear();
  const m2 = end.getUTCMonth() + 1;

  const d1 = Math.min(start.getUTCDate(), 30);
  const rawD2 = end.getUTCDate();
  const d2 = rawD2 > 30 && d1 >= 30 ? 30 : rawD2;

  return (y2 - y1) * 360 + (m2 - m1) * 30 + (d2 - d1);
}

/** The fraction of a year between two dates under the given convention. */
export function accrualFraction(
  dayCount: DayCount,
  start: Date,
  end: Date,
): number {
  switch (dayCount) {
    case "30/360":
      return days360(start, end) / 360;
    case "ACT/360":
      return actualDays(start, end) / 360;
    case "ACT/365":
      return actualDays(start, end) / 365;
  }
}

/**
 * Interest due for one period on a given outstanding balance.
 * Exported so the schedule builder and the validator agree by construction.
 */
export function periodInterest(
  outstanding: number,
  ratePct: number,
  dayCount: DayCount,
  periodStart: Date,
  periodEnd: Date,
): number {
  return outstanding * (ratePct / 100) * accrualFraction(dayCount, periodStart, periodEnd);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * @param now Injected so results are deterministic in tests and in the demo.
 */
export function validateTerms(
  terms: ExtractedTerms,
  now: Date = new Date(),
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const block = (field: TermField, message: string) =>
    issues.push({ field, severity: "blocking", message });
  const warn = (field: TermField, message: string) =>
    issues.push({ field, severity: "warning", message });

  const principal = terms.principal.value;
  const ratePct = terms.interestRatePct.value;
  const dayCount = terms.dayCount.value;
  const frequency = terms.paymentFrequency.value;
  const schedule = terms.schedule.value;

  // --- Enumerations -------------------------------------------------------
  if (!CURRENCIES.includes(terms.currency.value as Currency)) {
    block("currency", `${terms.currency.value} is not a supported settlement currency.`);
  }
  if (!DAY_COUNTS.includes(dayCount)) {
    block("dayCount", `${dayCount} is not a recognised day-count convention.`);
  }
  if (!PAYMENT_FREQUENCIES.includes(frequency)) {
    block("paymentFrequency", `${frequency} is not a recognised payment frequency.`);
  }

  // --- Scalars ------------------------------------------------------------
  if (!Number.isFinite(principal) || principal <= 0) {
    block("principal", "Principal must be a positive amount.");
  }
  if (!Number.isFinite(ratePct) || ratePct <= MIN_RATE_PCT || ratePct > MAX_RATE_PCT) {
    block(
      "interestRatePct",
      `Interest rate of ${ratePct}% is outside the accepted range (${MIN_RATE_PCT}–${MAX_RATE_PCT}%).`,
    );
  }

  // --- Dates --------------------------------------------------------------
  const agreementDate = parseISO(terms.agreementDate.value);
  const maturityDate = parseISO(terms.maturityDate.value);

  if (!agreementDate) {
    block("agreementDate", "Agreement date is not a valid date.");
  }
  if (!maturityDate) {
    block("maturityDate", "Maturity date is not a valid date.");
  }
  if (agreementDate && maturityDate) {
    if (agreementDate >= maturityDate) {
      block("maturityDate", "Maturity date must fall after the agreement date.");
    }
    if (maturityDate <= now) {
      block("maturityDate", "Maturity date is in the past; this note cannot be issued.");
    }
  }

  // --- Schedule -----------------------------------------------------------
  if (schedule.length === 0) {
    block("schedule", "No repayment schedule was extracted.");
    return { issues, consistent: false };
  }

  const scheduleIssues = validateSchedule({
    schedule,
    principal,
    ratePct,
    dayCount,
    frequency,
    agreementDate,
    maturityDate,
  });
  issues.push(...scheduleIssues);

  // --- Late payment -------------------------------------------------------
  const { gracePeriodDays, penaltyRatePct } = terms.latePayment.value;
  if (gracePeriodDays < 0) {
    block("latePayment", "Grace period cannot be negative.");
  }
  if (penaltyRatePct < 0) {
    block("latePayment", "Late-payment penalty rate cannot be negative.");
  }
  if (gracePeriodDays === 0) {
    warn(
      "latePayment",
      "No grace period: a single missed payment flips the note to Impaired immediately.",
    );
  }

  return {
    issues,
    consistent: !issues.some((issue) => issue.severity === "blocking"),
  };
}

function validateSchedule({
  schedule,
  principal,
  ratePct,
  dayCount,
  frequency,
  agreementDate,
  maturityDate,
}: {
  schedule: PaymentPeriod[];
  principal: number;
  ratePct: number;
  dayCount: DayCount;
  frequency: ExtractedTerms["paymentFrequency"]["value"];
  agreementDate: Date | null;
  maturityDate: Date | null;
}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const block = (message: string) =>
    issues.push({ field: "schedule", severity: "blocking", message });

  const dates = schedule.map((period) => parseISO(period.dueDate));
  if (dates.some((date) => date === null)) {
    block("Schedule contains an unparseable payment date.");
    return issues;
  }
  const dueDates = dates as Date[];

  // Ordering
  for (let i = 1; i < dueDates.length; i++) {
    if (dueDates[i] <= dueDates[i - 1]) {
      block(
        `Payment ${schedule[i].index} (${schedule[i].dueDate}) is not after payment ${schedule[i - 1].index}.`,
      );
      break;
    }
  }

  // Bounds against the agreement and maturity dates
  if (agreementDate && dueDates[0] <= agreementDate) {
    block("First payment falls on or before the agreement date.");
  }
  if (maturityDate) {
    const finalDue = dueDates[dueDates.length - 1];
    if (finalDue.getTime() !== maturityDate.getTime()) {
      block(
        `Final payment (${schedule[schedule.length - 1].dueDate}) does not fall on the maturity date (${maturityDate.toISOString().slice(0, 10)}).`,
      );
    }
  }

  // Cadence: the number of periods should match the declared frequency over the term.
  if (agreementDate && maturityDate) {
    const years =
      accrualFraction("ACT/365", agreementDate, maturityDate);
    const expectedPeriods = Math.round(years * PERIODS_PER_YEAR[frequency]);
    if (Math.abs(schedule.length - expectedPeriods) > 1) {
      block(
        `Schedule has ${schedule.length} payments, but a ${frequency} schedule over this term implies about ${expectedPeriods}.`,
      );
    }
  }

  // Principal must be fully repaid, and never over-repaid.
  const scheduledPrincipal = schedule.reduce((sum, p) => sum + p.principal, 0);
  if (Math.abs(scheduledPrincipal - principal) > 0.01) {
    block(
      `Scheduled principal repayments total ${scheduledPrincipal.toLocaleString()}, which does not match the stated principal of ${principal.toLocaleString()}.`,
    );
  }

  // Interest must reproduce the stated rate against the declining balance.
  if (agreementDate && Number.isFinite(ratePct) && ratePct > 0) {
    let outstanding = principal;
    let periodStart = agreementDate;
    let expectedTotal = 0;

    for (let i = 0; i < schedule.length; i++) {
      expectedTotal += periodInterest(
        outstanding,
        ratePct,
        dayCount,
        periodStart,
        dueDates[i],
      );
      outstanding -= schedule[i].principal;
      periodStart = dueDates[i];
    }

    const scheduledInterest = schedule.reduce((sum, p) => sum + p.interest, 0);
    const drift = Math.abs(scheduledInterest - expectedTotal);
    if (expectedTotal > 0 && drift / expectedTotal > INTEREST_TOLERANCE) {
      block(
        `Scheduled interest totals ${round2(scheduledInterest).toLocaleString()}, but ${ratePct}% on a ${dayCount} basis implies ${round2(expectedTotal).toLocaleString()}. The schedule does not reproduce the stated rate.`,
      );
    }
  }

  return issues;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Confidence gating
// ---------------------------------------------------------------------------

/**
 * Fields the model was unsure about and a human has not yet confirmed.
 * Independent of `validateTerms` — arithmetic consistency and extraction
 * certainty are different failure modes and the UI reports them separately.
 */
export function fieldsNeedingReview(terms: ExtractedTerms): TermField[] {
  return (Object.keys(terms) as TermField[]).filter((field) => {
    const extracted = terms[field];
    return extracted.confidence < LOW_CONFIDENCE_THRESHOLD && !extracted.editedByHuman;
  });
}

export interface MintGate {
  canMint: boolean;
  validation: ValidationResult;
  unreviewedFields: TermField[];
  /** Why minting is blocked, in the order a reviewer should address it. */
  blockers: string[];
}

/**
 * The single question the review screen asks: may these terms be minted?
 *
 * Three independent gates, all of which must pass — an unverified issuer, an
 * inconsistent schedule, and an unconfirmed low-confidence field each stop the
 * mint on their own.
 */
export function mintGate(
  terms: ExtractedTerms,
  issuerVerified: boolean,
  now: Date = new Date(),
): MintGate {
  const validation = validateTerms(terms, now);
  const unreviewedFields = fieldsNeedingReview(terms);
  const blockers: string[] = [];

  if (!issuerVerified) {
    blockers.push(
      "The connected wallet is not in the issuer registry. NoteFactory will revert this mint.",
    );
  }
  for (const issue of validation.issues) {
    if (issue.severity === "blocking") blockers.push(issue.message);
  }
  if (unreviewedFields.length > 0) {
    blockers.push(
      `${unreviewedFields.length} low-confidence ${unreviewedFields.length === 1 ? "field requires" : "fields require"} human verification.`,
    );
  }

  return {
    canMint: blockers.length === 0,
    validation,
    unreviewedFields,
    blockers,
  };
}
