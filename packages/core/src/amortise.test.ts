import { test, expect } from "bun:test";
import { rebalanceSchedule } from "./amortise";
import { validateTerms } from "./validator";
import type { ExtractedTerms, PaymentPeriod } from "./schema";

/**
 * The case this exists for is the first test: BranchOut's real figures, where
 * the model read every fact correctly and then allocated between the columns
 * with a slightly wrong periodic rate.
 */

const addMonths = (date: Date, n: number) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + n, date.getUTCDate()));
const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Twenty-four equal instalments of 67,840.94 from 1 April 2026, split the way
 * the model split them: totalling exactly right, allocated 336.79 out.
 */
function branchoutRows(): PaymentPeriod[] {
  const first = new Date("2026-04-01T00:00:00Z");
  const instalment = 67_840.94;
  const rows: PaymentPeriod[] = [];
  let balance = 1_500_000;

  for (let i = 0; i < 24; i++) {
    // 8%/12 rather than the rate the instalment actually implies — the error.
    const interest = Math.round(balance * (0.08 / 12) * 100) / 100;
    const principal = Math.round((instalment - interest) * 100) / 100;
    rows.push({ index: i + 1, dueDate: iso(addMonths(first, i)), principal, interest });
    balance = Math.round((balance - principal) * 100) / 100;
  }
  return rows;
}

const sum = (rows: PaymentPeriod[], key: "principal" | "interest") =>
  Math.round(rows.reduce((t, r) => t + r[key], 0) * 100) / 100;

test("the fixture reproduces the defect it is meant to fix", () => {
  const rows = branchoutRows();
  expect(sum(rows, "principal")).toBeGreaterThan(1_500_000);
  // Total paid is exactly right; only the allocation is wrong.
  expect(sum(rows, "principal") + sum(rows, "interest")).toBeCloseTo(24 * 67_840.94, 1);
});

test("rebalancing retires the principal exactly", () => {
  const repaired = rebalanceSchedule({
    schedule: branchoutRows(), principal: 1_500_000,
    dayCount: "ACT/365", frequency: "monthly", agreementDate: "2025-09-15",
  });

  expect(repaired).not.toBeNull();
  expect(sum(repaired!.schedule, "principal")).toBe(1_500_000);
});

test("rebalancing changes the split and nothing else", () => {
  const before = branchoutRows();
  const repaired = rebalanceSchedule({
    schedule: before, principal: 1_500_000,
    dayCount: "ACT/365", frequency: "monthly", agreementDate: "2025-09-15",
  })!;

  // Dates and what is paid on them are what the document states, and must not move.
  for (let i = 0; i < before.length; i++) {
    expect(repaired.schedule[i]!.dueDate).toBe(before[i]!.dueDate);
    expect(repaired.schedule[i]!.index).toBe(before[i]!.index);
  }
  const paid = (rows: PaymentPeriod[]) => sum(rows, "principal") + sum(rows, "interest");
  expect(paid(repaired.schedule)).toBeCloseTo(paid(before), 0);
});

test("the repaired schedule passes the validator that refused the original", () => {
  const field = <T>(value: T) => ({ value, confidence: 1, sourceQuote: "q", note: null });
  const terms = (schedule: PaymentPeriod[]) =>
    ({
      borrower: field("BranchOut Foods Inc."), lender: field("ENWAVE CORPORATION"),
      principal: field(1_500_000), interestRatePct: field(8),
      dayCount: field("ACT/365"), agreementDate: field("2025-09-15"),
      maturityDate: field(schedule[schedule.length - 1]!.dueDate),
      paymentFrequency: field("monthly"), schedule: field(schedule),
      covenants: field([]), latePayment: field({ gracePeriodDays: 10, penaltyRatePct: 2 }),
    }) as unknown as ExtractedTerms;

  const now = new Date("2026-01-01T00:00:00Z");
  const before = validateTerms(terms(branchoutRows()), now);
  expect(before.issues.some((i) =>
    i.severity === "blocking" && i.message.includes("does not match the stated principal"))).toBe(true);

  const repaired = rebalanceSchedule({
    schedule: branchoutRows(), principal: 1_500_000,
    dayCount: "ACT/365", frequency: "monthly", agreementDate: "2025-09-15",
  })!;
  const after = validateTerms(terms(repaired.schedule), now);
  expect(after.issues.filter((i) => i.severity === "blocking")).toEqual([]);
  expect(after.consistent).toBe(true);
});

test("payments that cannot repay the loan are refused, not massaged", () => {
  const rows = branchoutRows().map((r) => ({ ...r, principal: r.principal / 10, interest: 0 }));
  const repaired = rebalanceSchedule({
    schedule: rows, principal: 1_500_000,
    dayCount: "ACT/365", frequency: "monthly", agreementDate: "2025-09-15",
  });
  expect(repaired).toBeNull();
});

test("an unparseable date is refused", () => {
  const rows = branchoutRows();
  rows[3] = { ...rows[3]!, dueDate: "not a date" };
  expect(rebalanceSchedule({
    schedule: rows, principal: 1_500_000,
    dayCount: "ACT/365", frequency: "monthly", agreementDate: "2025-09-15",
  })).toBeNull();
});

test("an empty schedule is refused", () => {
  expect(rebalanceSchedule({
    schedule: [], principal: 1_500_000,
    dayCount: "ACT/365", frequency: "monthly", agreementDate: "2025-09-15",
  })).toBeNull();
});

test("the implied rate is recovered close to the stated one", () => {
  const repaired = rebalanceSchedule({
    schedule: branchoutRows(), principal: 1_500_000,
    dayCount: "ACT/365", frequency: "monthly", agreementDate: "2025-09-15",
  })!;
  // The note states 8%; the instalment implies very near it.
  expect(repaired.impliedRatePct).toBeGreaterThan(7);
  expect(repaired.impliedRatePct).toBeLessThan(9);
});
