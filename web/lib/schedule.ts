/**
 * Repayment lifecycle derived from a note's schedule and what has settled.
 *
 * Everything here is a pure function of (schedule, paidPeriods, now), matching
 * how `RepaymentVault` decides the same questions on-chain — a period is late
 * because the chain's clock passed its due date, not because anyone marked it.
 */

import type { Note, PaymentPeriod } from "./types";

export type PeriodStatus = "paid" | "overdue" | "due" | "scheduled";

/**
 * `due` is the next payment not yet settled and not yet late. `overdue` means
 * the due date has passed unpaid — still inside the grace period, so the note
 * is not impaired yet.
 */
export function periodStatus(
  period: PaymentPeriod,
  paidPeriods: number[],
  now: Date,
): PeriodStatus {
  if (paidPeriods.includes(period.index)) return "paid";
  const due = new Date(`${period.dueDate}T00:00:00Z`);
  if (due < now) return "overdue";
  return "due";
}

/** The full schedule with each period's status resolved. */
export function scheduleWithStatus(
  note: Note,
  now: Date,
): Array<PaymentPeriod & { status: PeriodStatus }> {
  const schedule = note.terms.schedule.value;
  let seenUpcoming = false;

  return schedule.map((period) => {
    const status = periodStatus(period, note.paidPeriods, now);
    if (status === "due") {
      // Only the earliest unsettled future period is "due"; the rest are queued.
      if (seenUpcoming) return { ...period, status: "scheduled" as const };
      seenUpcoming = true;
    }
    return { ...period, status };
  });
}

/** The next payment the issuer owes, if any remain. */
export function nextCoupon(note: Note, now: Date): PaymentPeriod | undefined {
  return scheduleWithStatus(note, now).find(
    (period) => period.status === "due" || period.status === "overdue",
  );
}

/**
 * A note is impaired once a payment is later than its grace period allows.
 * `RepaymentVault` flips the note into `Impaired`, which blocks transfers.
 */
export function impairment(
  note: Note,
  now: Date,
): { impaired: boolean; period?: PaymentPeriod; daysLate: number } {
  const grace = note.terms.latePayment.value.gracePeriodDays;

  for (const period of note.terms.schedule.value) {
    if (note.paidPeriods.includes(period.index)) continue;
    const due = new Date(`${period.dueDate}T00:00:00Z`);
    const daysLate = Math.floor(
      (now.getTime() - due.getTime()) / 86_400_000,
    );
    if (daysLate > grace) {
      return { impaired: true, period, daysLate };
    }
    if (daysLate >= 0) {
      return { impaired: false, period, daysLate };
    }
  }
  return { impaired: false, daysLate: 0 };
}

/** Interest paid to date plus interest still to come. */
export function couponTotals(note: Note) {
  const schedule = note.terms.schedule.value;
  const settled = schedule
    .filter((period) => note.paidPeriods.includes(period.index))
    .reduce((sum, period) => sum + period.interest, 0);
  const total = schedule.reduce((sum, period) => sum + period.interest, 0);
  return { settled, total, outstanding: total - settled };
}
