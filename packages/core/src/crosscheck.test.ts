import { test, expect } from "bun:test";
import { applyDisagreements, compareExtractions } from "./crosscheck";
import type { ExtractedTerms, PaymentPeriod } from "./schema";

/**
 * The comparison is pure and its inputs are two whole extractions, which makes
 * it one of the few things in this project that can be tested properly without
 * a model, a chain, or a database.
 *
 * The case that matters most is the last one: two readings that are each
 * internally consistent and are not the same reading. That is the failure this
 * file exists for, and no single-reading check can see it.
 */

const field = <T>(value: T, confidence = 1) => ({
  value,
  confidence,
  sourceQuote: "as stated",
  note: null,
});

const schedule = (rows: Partial<PaymentPeriod>[]): PaymentPeriod[] =>
  rows.map((row, i) => ({
    index: row.index ?? i + 1,
    dueDate: row.dueDate ?? monthly(i),
    principal: row.principal ?? 1000,
    interest: row.interest ?? 100,
  }));

/** Month `i` of a schedule starting 2026-01-01, so long schedules stay valid. */
const monthly = (i: number) => {
  const date = new Date(Date.UTC(2026, i, 1));
  return date.toISOString().slice(0, 10);
};

const terms = (overrides: Partial<Record<string, unknown>> = {}) =>
  ({
    borrower: field("Northbridge Manufacturing LLC"),
    lender: field("Crossmind Capital Partners"),
    principal: field(1_500_000),
    interestRatePct: field(8.5),
    dayCount: field("ACT/365"),
    agreementDate: field("2026-03-01"),
    maturityDate: field("2028-03-01"),
    paymentFrequency: field("monthly"),
    schedule: field(schedule([{}, {}])),
    covenants: field([]),
    latePayment: field({ gracePeriodDays: 10, penaltyRatePct: 2 }),
    ...overrides,
  }) as unknown as ExtractedTerms;

test("two identical readings disagree about nothing", () => {
  expect(compareExtractions(terms(), terms())).toEqual([]);
});

test("a party's name wrapped differently is the same name", () => {
  const wrapped = terms({ borrower: field("Northbridge\n  Manufacturing LLC") });
  expect(compareExtractions(terms(), wrapped)).toEqual([]);
});

test("a party's name punctuated differently is a different entity", () => {
  const suffixed = terms({ borrower: field("Northbridge Manufacturing, LLC") });
  const found = compareExtractions(terms(), suffixed);
  expect(found).toHaveLength(1);
  expect(found[0]!.field).toBe("borrower");
});

test("floating point noise is not a disagreement", () => {
  const noisy = terms({ principal: field(1_500_000.000000002) });
  expect(compareExtractions(terms(), noisy)).toEqual([]);
});

test("a cent of principal is", () => {
  const off = terms({ principal: field(1_500_000.02) });
  const found = compareExtractions(terms(), off);
  expect(found).toHaveLength(1);
  expect(found[0]!.message).toContain("1,500,000");
});

test("a different rate is reported with both readings", () => {
  const found = compareExtractions(terms(), terms({ interestRatePct: field(9.4) }));
  expect(found).toHaveLength(1);
  expect(found[0]!.field).toBe("interestRatePct");
  expect(found[0]!.message).toBe("read as 8.5% once and 9.4% the second time");
});

test("a different maturity is reported", () => {
  const found = compareExtractions(terms(), terms({ maturityDate: field("2028-04-01") }));
  expect(found).toHaveLength(1);
  expect(found[0]!.field).toBe("maturityDate");
});

test("schedules of different lengths disagree on their length", () => {
  const shorter = terms({ schedule: field(schedule([{}])) });
  const found = compareExtractions(terms(), shorter);
  expect(found).toHaveLength(1);
  expect(found[0]!.message).toBe("built 2 payments once and 1 the second time");
});

/**
 * The measured failure, reduced to two rows.
 *
 * Both readings state the same principal, the same rate and the same dates.
 * Both schedules have the same number of periods. Every single-reading check
 * this project has passes on each of them. They are not the same schedule.
 */
test("two internally tidy schedules that are not the same schedule", () => {
  const blended = terms({
    schedule: field(
      schedule([
        { principal: 672_165, interest: 0 },
        { principal: 672_165, interest: 0 },
      ]),
    ),
  });
  const split = terms({
    schedule: field(
      schedule([
        { principal: 750_059, interest: 63_750 },
        { principal: 750_060, interest: 32_130 },
      ]),
    ),
  });

  const found = compareExtractions(blended, split);
  expect(found).toHaveLength(1);
  expect(found[0]!.field).toBe("schedule");
  expect(found[0]!.message).toContain("principal column came to 1,344,330");
  expect(found[0]!.message).toContain("1,500,119");
  expect(found[0]!.message).toContain("interest column");
});

test("a disagreement caps confidence and says why, without touching the input", () => {
  const original = terms({ principal: field(1_500_000, 1) });
  const flagged = applyDisagreements(original, [
    { field: "principal", message: "read as 1 once and 2 the second time" },
  ]);

  expect(flagged.principal.confidence).toBe(0.5);
  expect(flagged.principal.note).toContain("read twice");
  // The reading handed in is evidence, and must survive being inspected.
  expect(original.principal.confidence).toBe(1);
  expect(original.principal.note).toBeNull();
});

test("an already-doubtful field is not promoted by disagreeing", () => {
  const doubtful = terms({ principal: field(1_500_000, 0.2) });
  const flagged = applyDisagreements(doubtful, [
    { field: "principal", message: "differed" },
  ]);
  expect(flagged.principal.confidence).toBe(0.2);
});

test("no disagreements leaves the terms exactly as they were", () => {
  const original = terms();
  expect(applyDisagreements(original, [])).toBe(original);
});

test("a few cents of rounding across a long schedule is not a disagreement", () => {
  const rows = Array.from({ length: 24 }, () => ({}));
  const a = terms({ schedule: field(schedule(rows)) });
  const b = terms({
    schedule: field(
      schedule(rows.map((_, i) => (i === 0 ? { principal: 1000.1 } : {}))),
    ),
  });
  expect(compareExtractions(a, b)).toEqual([]);
});

test("but a different amortisation across the same schedule is", () => {
  const rows = Array.from({ length: 24 }, () => ({}));
  const a = terms({ schedule: field(schedule(rows)) });
  const b = terms({
    schedule: field(
      schedule(rows.map((_, i) => (i === 0 ? { principal: 1016 } : {}))),
    ),
  });
  expect(compareExtractions(a, b)).toHaveLength(1);
});
