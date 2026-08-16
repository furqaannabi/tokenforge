import { test, expect } from "bun:test";
import { periodInterest, validateTerms } from "./validator";
import type { DayCount, ExtractedTerms, PaymentPeriod } from "./schema";

/**
 * The two checks that measure a schedule against time.
 *
 * Both used to start the clock at the agreement date, which is right only when
 * repayment begins one period after signing. A loan signed in September whose
 * first instalment falls the following April is an ordinary loan, and both
 * checks blocked it — the cadence check by counting the months before
 * repayment as missed payments, the interest check by accruing all of them at
 * the full principal. Four of the twelve filed agreements in `agreements/`
 * failed for that reason and no other.
 *
 * These fix the boundary without loosening either check, so both directions
 * are tested: the correct schedule passes, and the schedule that is genuinely
 * wrong still fails.
 */

const addMonths = (date: Date, months: number) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()));

const addDays = (date: Date, days: number) =>
  new Date(date.getTime() + days * 86_400_000);

const iso = (date: Date) => date.toISOString().slice(0, 10);
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * An amortising schedule that is correct by construction: the principal column
 * sums to the principal exactly, and each period's interest is the rate applied
 * to the declining balance over that period alone.
 */
function buildSchedule({
  principal,
  ratePct,
  dayCount,
  count,
  firstDue,
  step,
}: {
  principal: number;
  ratePct: number;
  dayCount: DayCount;
  count: number;
  firstDue: Date;
  step: (from: Date, n: number) => Date;
}): PaymentPeriod[] {
  const rows: PaymentPeriod[] = [];
  let outstanding = principal;
  let periodStart = step(firstDue, -1);

  for (let i = 0; i < count; i++) {
    const due = step(firstDue, i);
    const interest = periodInterest(outstanding, ratePct, dayCount, periodStart, due);
    // The final row absorbs the rounding so the column sums exactly.
    const part = i === count - 1 ? outstanding : round2(principal / count);

    rows.push({
      index: i + 1,
      dueDate: iso(due),
      principal: round2(part),
      interest: round2(interest),
    });

    outstanding = round2(outstanding - part);
    periodStart = due;
  }

  return rows;
}

const field = <T>(value: T) => ({
  value,
  confidence: 1,
  sourceQuote: "as stated",
  note: null,
});

function terms({
  agreementDate,
  schedule,
  principal,
  ratePct,
  dayCount = "ACT/365",
  frequency = "monthly",
}: {
  agreementDate: string;
  schedule: PaymentPeriod[];
  principal: number;
  ratePct: number;
  dayCount?: DayCount;
  frequency?: string;
}): ExtractedTerms {
  return {
    borrower: field("Acme Operating Co"),
    lender: field("Acme Credit Partners"),
    principal: field(principal),
    interestRatePct: field(ratePct),
    dayCount: field(dayCount),
    agreementDate: field(agreementDate),
    // The validator requires the final payment to fall on the maturity date,
    // so the schedule defines it rather than the other way round.
    maturityDate: field(schedule[schedule.length - 1]!.dueDate),
    paymentFrequency: field(frequency),
    schedule: field(schedule),
    covenants: field([]),
    latePayment: field({ gracePeriodDays: 10, penaltyRatePct: 2 }),
  } as unknown as ExtractedTerms;
}

/** Before every maturity used here, so "matured already" never fires. */
const NOW = new Date("2025-01-01T00:00:00Z");

const blocking = (t: ExtractedTerms) =>
  validateTerms(t, NOW).issues.filter((i) => i.severity === "blocking");

const monthly = (from: Date, n: number) => addMonths(from, n);
const quarterly = (from: Date, n: number) => addMonths(from, n * 3);

test("an ordinary schedule, first payment one period after signing, validates", () => {
  const firstDue = new Date("2026-02-01T00:00:00Z");
  const schedule = buildSchedule({
    principal: 1_200_000, ratePct: 8, dayCount: "ACT/365",
    count: 12, firstDue, step: monthly,
  });
  const result = validateTerms(terms({
    agreementDate: "2026-01-01", schedule, principal: 1_200_000, ratePct: 8,
  }), NOW);

  expect(result.issues.filter((i) => i.severity === "blocking")).toEqual([]);
  expect(result.consistent).toBe(true);
});

/**
 * The BranchOut shape: signed September 2025, first instalment April 2026.
 * Measured from signature this is a 30-month term carrying 24 payments, and
 * both checks fired. Measured across the payments it is exactly right.
 */
test("a delayed first payment is not a cadence failure", () => {
  const firstDue = new Date("2026-04-01T00:00:00Z");
  const schedule = buildSchedule({
    principal: 1_500_000, ratePct: 8, dayCount: "ACT/365",
    count: 24, firstDue, step: monthly,
  });
  const found = blocking(terms({
    agreementDate: "2025-09-15", schedule, principal: 1_500_000, ratePct: 8,
  }));

  expect(found.filter((i) => i.message.includes("implies about"))).toEqual([]);
});

test("a delayed first payment does not inflate the expected interest", () => {
  const firstDue = new Date("2026-04-01T00:00:00Z");
  const schedule = buildSchedule({
    principal: 1_500_000, ratePct: 8, dayCount: "ACT/365",
    count: 24, firstDue, step: monthly,
  });
  const found = blocking(terms({
    agreementDate: "2025-09-15", schedule, principal: 1_500_000, ratePct: 8,
  }));

  expect(found.filter((i) => i.message.includes("reproduce the stated rate"))).toEqual([]);
});

/**
 * The Loop Media shape, and the reason the cadence check exists: the payments
 * are weekly and the terms call them monthly. Thirty payments across seven
 * months disagrees with "monthly" whichever end the span is measured from.
 */
test("a frequency that does not describe the payments still blocks", () => {
  const firstDue = new Date("2026-01-07T00:00:00Z");
  const weekly = (from: Date, n: number) => addDays(from, n * 7);
  const schedule = buildSchedule({
    principal: 600_000, ratePct: 30, dayCount: "ACT/365",
    count: 30, firstDue, step: weekly,
  });
  const found = blocking(terms({
    agreementDate: "2025-12-27", schedule, principal: 600_000, ratePct: 30,
    frequency: "monthly",
  }));

  expect(found.some((i) => i.message.includes("implies about"))).toBe(true);
});

/** N payments span N-1 gaps. Six quarterly payments cover fifteen months. */
test("the period count counts payments, not the gaps between them", () => {
  const firstDue = new Date("2026-03-15T00:00:00Z");
  const schedule = buildSchedule({
    principal: 60_000, ratePct: 12, dayCount: "30/360",
    count: 6, firstDue, step: quarterly,
  });
  const found = blocking(terms({
    agreementDate: "2025-12-15", schedule, principal: 60_000, ratePct: 12,
    dayCount: "30/360", frequency: "quarterly",
  }));

  expect(found.filter((i) => i.message.includes("implies about"))).toEqual([]);
});

test("a schedule with too few payments for its declared frequency still blocks", () => {
  const firstDue = new Date("2026-02-01T00:00:00Z");
  // Five payments spaced a year apart, declared monthly.
  const yearly = (from: Date, n: number) => addMonths(from, n * 12);
  const schedule = buildSchedule({
    principal: 500_000, ratePct: 6, dayCount: "ACT/365",
    count: 5, firstDue, step: yearly,
  });
  const found = blocking(terms({
    agreementDate: "2026-01-01", schedule, principal: 500_000, ratePct: 6,
    frequency: "monthly",
  }));

  expect(found.some((i) => i.message.includes("implies about"))).toBe(true);
});
