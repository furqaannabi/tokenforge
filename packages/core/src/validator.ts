/**
 * The deterministic validator.
 *
 * Rules, not AI. It runs on extracted values alone and ignores confidence
 * entirely: a term set the model was 99% sure about still fails if the schedule
 * does not reproduce the stated rate. Any blocking issue makes the terms
 * unmintable, so the contract never receives numbers nobody checked.
 *
 * Confidence is a separate question, handled by `mintGate` below — a field can
 * be arithmetically consistent and still too uncertain to mint unsupervised.
 *
 * This is the single copy. The web app and the extraction service both import
 * it, so a reviewer and the server can never disagree about whether a set of
 * terms is mintable.
 */

import {
  CURRENCIES,
  DAY_COUNTS,
  PAYMENT_FREQUENCIES,
  PERIODS_PER_YEAR,
  type DayCount,
  type ExtractedTerms,
  type PaymentFrequency,
  type PaymentPeriod,
  type TermField,
} from "./schema";

/** Fields at or below this confidence need a human before minting. */
export const LOW_CONFIDENCE_THRESHOLD = 0.9;

/** Coupon math tolerance, as a fraction of computed interest. */
const INTEREST_TOLERANCE = 0.01;

/** Rates outside this band are extraction failures, not exotic loans. */
const MIN_RATE_PCT = 0;
const MAX_RATE_PCT = 40;

export interface ValidationIssue {
  field: TermField;
  /** `blocking` prevents minting. `warning` is surfaced but mintable. */
  severity: "blocking" | "warning";
  message: string;
}

export interface ValidationResult {
  issues: ValidationIssue[];
  /** True when nothing blocking was found. Confidence is not considered. */
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

/** Fraction of a year between two dates under the given convention. */
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

/** Interest for one period on a given outstanding balance. */
export function periodInterest(
  outstanding: number,
  ratePct: number,
  dayCount: DayCount,
  periodStart: Date,
  periodEnd: Date,
): number {
  return (
    outstanding *
    (ratePct / 100) *
    accrualFraction(dayCount, periodStart, periodEnd)
  );
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * @param now Injected so results are deterministic in tests and demos.
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
  if (!DAY_COUNTS.includes(dayCount)) {
    block("dayCount", `${dayCount} is not a recognised day-count convention.`);
  }
  if (!PAYMENT_FREQUENCIES.includes(frequency)) {
    block(
      "paymentFrequency",
      `${frequency} is not a recognised payment frequency.`,
    );
  }

  // --- Scalars ------------------------------------------------------------
  if (!Number.isFinite(principal) || principal <= 0) {
    block("principal", "Principal must be a positive amount.");
  }
  if (
    !Number.isFinite(ratePct) ||
    ratePct <= MIN_RATE_PCT ||
    ratePct > MAX_RATE_PCT
  ) {
    block(
      "interestRatePct",
      `Interest rate of ${ratePct}% is outside the accepted range (${MIN_RATE_PCT}–${MAX_RATE_PCT}%).`,
    );
  }

  // --- Dates --------------------------------------------------------------
  const agreementDate = parseISO(terms.agreementDate.value);
  const maturityDate = parseISO(terms.maturityDate.value);

  if (!agreementDate) block("agreementDate", "Agreement date is not a valid date.");
  if (!maturityDate) block("maturityDate", "Maturity date is not a valid date.");

  if (agreementDate && maturityDate) {
    if (agreementDate >= maturityDate) {
      block("maturityDate", "Maturity date must fall after the agreement date.");
    }
    if (maturityDate <= now) {
      block(
        "maturityDate",
        "Maturity date is in the past; this note cannot be issued.",
      );
    }
  }

  // --- Schedule -----------------------------------------------------------
  if (schedule.length === 0) {
    block("schedule", "No repayment schedule was extracted.");
    return { issues, consistent: false };
  }

  issues.push(
    ...validateSchedule({
      schedule,
      principal,
      ratePct,
      dayCount,
      frequency,
      agreementDate,
      maturityDate,
    }),
  );

  // --- Late payment -------------------------------------------------------
  const { gracePeriodDays, penaltyRatePct } = terms.latePayment.value;
  if (gracePeriodDays < 0) block("latePayment", "Grace period cannot be negative.");
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
  frequency: PaymentFrequency;
  agreementDate: Date | null;
  maturityDate: Date | null;
}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const block = (message: string) =>
    issues.push({ field: "schedule" as TermField, severity: "blocking", message });

  const dates = schedule.map((period) => parseISO(period.dueDate));
  if (dates.some((date) => date === null)) {
    block("Schedule contains an unparseable payment date.");
    return issues;
  }
  const dueDates = dates as Date[];

  // Ordering
  for (let i = 1; i < dueDates.length; i++) {
    if (dueDates[i]! <= dueDates[i - 1]!) {
      block(
        `Payment ${schedule[i]!.index} (${schedule[i]!.dueDate}) is not after payment ${schedule[i - 1]!.index}.`,
      );
      break;
    }
  }

  // Bounds against the agreement and maturity dates
  if (agreementDate && dueDates[0]! <= agreementDate) {
    block("First payment falls on or before the agreement date.");
  }
  if (maturityDate) {
    const finalDue = dueDates[dueDates.length - 1]!;
    if (finalDue.getTime() !== maturityDate.getTime()) {
      block(
        `Final payment (${schedule[schedule.length - 1]!.dueDate}) does not fall on the maturity date (${maturityDate.toISOString().slice(0, 10)}).`,
      );
    }
  }

  /*
   * Cadence: the payments should be spaced at the frequency the terms declare.
   *
   * Measured across the schedule's own span — first payment to last — rather
   * than from the agreement date, and the difference is not academic. A loan
   * signed in September whose first instalment falls the following April is a
   * perfectly ordinary loan; measuring its term from signature counts the
   * months before repayment began as though payments had been missed, and this
   * check then blocks a schedule that is exactly right. Four of the twelve
   * filed agreements in `agreements/` failed here for that reason alone.
   *
   * What it still catches is the error it was written for: a frequency that
   * does not describe the payments. Loop Media declares monthly and pays
   * weekly, and 30 payments across seven months disagrees with "monthly" no
   * matter which end the term is measured from.
   *
   * N payments span N-1 gaps, which is where the `+ 1` comes from — the
   * off-by-one that made a correct schedule look one payment short.
   */
  if (schedule.length > 1) {
    const years = accrualFraction(
      "ACT/365",
      dueDates[0]!,
      dueDates[dueDates.length - 1]!,
    );
    const expectedPeriods =
      Math.round(years * PERIODS_PER_YEAR[frequency]) + 1;
    if (Math.abs(schedule.length - expectedPeriods) > 1) {
      block(
        `Schedule has ${schedule.length} payments, but a ${frequency} schedule over this span implies about ${expectedPeriods}.`,
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

  /*
   * Interest must reproduce the stated rate against the declining balance.
   *
   * The first period starts one period before the first payment, or at the
   * agreement date if that is later — whichever gives the shorter first
   * period.
   *
   * Starting it at the agreement date unconditionally, as this once did, makes
   * the same mistake as the cadence check above and costs more: where
   * repayment begins months after signing, the first period accrues all of
   * that time at the full principal, and the expected total comes out far
   * above what the document itself states. BranchOut states 128,182 of total
   * interest in its own arithmetic; this check demanded 183,360 and blocked
   * the schedule for reproducing the document correctly.
   *
   * The `max` keeps the ordinary case exactly as it was: when the first
   * payment is one period after signing, one period before it *is* the
   * agreement date. Only a delayed start moves.
   */
  if (agreementDate && Number.isFinite(ratePct) && ratePct > 0) {
    let outstanding = principal;
    const periodMs = (365 / PERIODS_PER_YEAR[frequency]) * 86_400_000;
    const onePeriodBefore = new Date(dueDates[0]!.getTime() - periodMs);
    let periodStart =
      onePeriodBefore > agreementDate ? onePeriodBefore : agreementDate;
    let expectedTotal = 0;

    for (let i = 0; i < schedule.length; i++) {
      expectedTotal += periodInterest(
        outstanding,
        ratePct,
        dayCount,
        periodStart,
        dueDates[i]!,
      );
      outstanding -= schedule[i]!.principal;
      periodStart = dueDates[i]!;
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

/**
 * Checks the settlement currency chosen at issuance.
 *
 * Separate from `validateTerms` because it validates a decision rather than an
 * extraction: no document states which stablecoin a note pays in, so there is
 * nothing here for a model to have got wrong.
 */
export function validateSettlementCurrency(currency: string): string | null {
  return (CURRENCIES as readonly string[]).includes(currency)
    ? null
    : `${currency} is not a supported settlement currency.`;
}

// ---------------------------------------------------------------------------
// Confidence gating
// ---------------------------------------------------------------------------

/**
 * Fields the model was unsure about that a human has not yet vouched for.
 *
 * Confirmation arrives two ways and both count. The web app flips
 * `editedByHuman` on the field as a reviewer works through the screen; the
 * service is handed an explicit set of confirmed keys with a review request.
 * Treating either as sufficient is what lets one implementation serve both.
 */
/**
 * The fields a reviewer can actually act on, and the only ones that block.
 *
 * Every one of these either enters the mint hash or decides the schedule the
 * contract will enforce, and every one has a control in the review screen.
 *
 * The extraction carries more than this — covenants, late-payment terms — and
 * those keep their confidence and are worth reading. They must not gate a
 * mint, because there is nowhere to confirm them: a low score on a field with
 * no editor left the submit button disabled with no way to clear it, which is
 * indistinguishable from the app being broken.
 */
export const REVIEWABLE_FIELDS: readonly TermField[] = [
  "principal",
  "interestRatePct",
  "dayCount",
  "agreementDate",
  "maturityDate",
  "paymentFrequency",
  "borrower",
  "lender",
] as const;

export function fieldsNeedingReview(
  terms: ExtractedTerms,
  confirmed: ReadonlySet<string> = new Set(),
): TermField[] {
  return REVIEWABLE_FIELDS.filter((key) => {
    const extracted = terms[key];
    if (!extracted) return false;
    if (extracted.confidence >= LOW_CONFIDENCE_THRESHOLD) return false;
    return !extracted.editedByHuman && !confirmed.has(key);
  });
}

/**
 * The result of the two checks that compare a document against the world
 * outside it, rather than against itself. Shaped to match what the extraction
 * service stores, so neither side reshapes the other's answer.
 */
export interface ProvenanceVerdict {
  ownership?: {
    belongsToIssuer: boolean;
    confidence: number;
    documentLender: string;
    reason: string;
  };
  borrower?: {
    matchesDocument: boolean;
    confidence: number;
    documentBorrower: string;
    reason: string;
  } | null;
  duplicate?: {
    isDuplicate: boolean;
    ofExtractionId: string | null;
    confidence: number;
    reason: string;
  };
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
 * Three independent gates. An unverified issuer, an inconsistent schedule, and
 * an unconfirmed low-confidence field each stop the mint on their own.
 */
export function mintGate(
  terms: ExtractedTerms,
  issuerVerified: boolean,
  options: {
    /** Field keys a reviewer confirmed out of band, rather than on the field. */
    confirmed?: ReadonlySet<string>;
    /** Injected so the demo and tests get a stable answer. */
    now?: Date;
    /**
     * The two checks a hash cannot make, when they have been run. Absent means
     * not yet checked, which does not block — the gate says what is known, and
     * refusing everything unchecked would stop the demo dead the moment the
     * model key was missing.
     */
    provenance?: ProvenanceVerdict;
  } = {},
): MintGate {
  const { confirmed = new Set<string>(), now = new Date(), provenance } = options;

  const validation = validateTerms(terms, now);
  const unreviewedFields = fieldsNeedingReview(terms, confirmed);
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
      `${unreviewedFields.length} low-confidence ${
        unreviewedFields.length === 1 ? "field requires" : "fields require"
      } human verification.`,
    );
  }

  /*
   * Both of these are a model's judgement, so they block rather than refuse
   * outright: a reviewer who knows the entity structure can look at the reason
   * and decide. What they must not do is pass silently.
   */
  if (provenance?.ownership && !provenance.ownership.belongsToIssuer) {
    blockers.push(
      `This document names ${provenance.ownership.documentLender} as the lender, not the issuing wallet. ${provenance.ownership.reason}`,
    );
  }
  if (provenance?.borrower && !provenance.borrower.matchesDocument) {
    blockers.push(
      `The wallet named as borrower is not the company this document says is borrowing. ${provenance.borrower.reason}`,
    );
  }
  if (provenance?.duplicate?.isDuplicate) {
    blockers.push(
      `This agreement has already been extracted under a different file. ${provenance.duplicate.reason}`,
    );
  }

  return { canMint: blockers.length === 0, validation, unreviewedFields, blockers };
}
