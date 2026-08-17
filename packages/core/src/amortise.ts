import { PERIODS_PER_YEAR, type DayCount, type PaymentFrequency, type PaymentPeriod } from "./schema";
import { periodInterest } from "./validator";

/**
 * Splitting a payment into principal and interest, in code rather than in the
 * model.
 *
 * A language model reads a document well and runs a twenty-four period
 * amortisation badly, and the second is not a prompting problem. BranchOut is
 * the case that made this obvious: the model read the principal, the
 * instalment, the count and every date correctly, and its rows summed to
 * 1,628,182.56 — exactly 24 x 67,840.94, to the cent. What it got wrong was
 * only the split between the columns, by 336.79 in each direction, because it
 * amortised with a slightly wrong periodic rate. The validator refused it, and
 * was right to: a principal column that does not retire the principal is not a
 * repayment schedule.
 *
 * So this takes back the arithmetic. Everything the document states is left
 * exactly as extracted — the dates, and what is paid on each of them — and only
 * the allocation is recomputed, from the one fact that determines it: the
 * balance must reach zero on the final row.
 *
 * WHAT THIS IS NOT. It is not a way to make a bad extraction pass. It cannot
 * change what is paid or when, so a schedule that does not repay the loan still
 * does not repay it — `null` comes back and the validator refuses as before.
 * The only thing it can fix is an arithmetic error in work the model should
 * never have been asked to do.
 */

/** Two runs of bisection either side of any plausible rate. */
const MIN_RATE_PCT = 0;
const MAX_RATE_PCT = 200;
const ITERATIONS = 200;

/** Currency, so the columns add up the way a statement does. */
const round2 = (n: number) => Math.round(n * 100) / 100;

const parseISO = (date: string): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export interface Rebalanced {
  schedule: PaymentPeriod[];
  /** The rate the payments actually imply, which is worth showing a reviewer. */
  impliedRatePct: number;
}

/**
 * Recomputes the principal and interest columns from the payments themselves.
 *
 * The first period starts one period before the first payment, or at the
 * agreement date if that is later — the same rule the validator applies, so the
 * two cannot disagree about what a period is.
 *
 * Returns `null` when the schedule cannot be repaired, which is every case
 * where something other than the split is wrong: an unparseable date, payments
 * that never retire the principal, or an implied rate outside any range a loan
 * could carry. Refusing is the honest answer there — the document and the
 * extraction disagree about more than arithmetic.
 */
export function rebalanceSchedule({
  schedule,
  principal,
  dayCount,
  frequency,
  agreementDate,
}: {
  schedule: readonly PaymentPeriod[];
  principal: number;
  dayCount: DayCount;
  frequency: PaymentFrequency;
  agreementDate: string;
}): Rebalanced | null {
  if (schedule.length === 0 || !(principal > 0)) return null;

  const dueDates: Date[] = [];
  for (const row of schedule) {
    const parsed = parseISO(row.dueDate);
    if (!parsed) return null;
    dueDates.push(parsed);
  }

  const signed = parseISO(agreementDate);
  if (!signed) return null;

  // What the document says is paid on each date. This is the part the model
  // reads well and the part that must not move.
  const payments = schedule.map((row) => row.principal + row.interest);
  if (payments.some((amount) => !(amount > 0))) return null;

  const periodMs = (365 / PERIODS_PER_YEAR[frequency]) * 86_400_000;
  const onePeriodBefore = new Date(dueDates[0]!.getTime() - periodMs);
  const start = onePeriodBefore > signed ? onePeriodBefore : signed;

  /**
   * The balance left after applying every payment at rate `r`.
   *
   * Monotonic in `r` — a higher rate sends more of each payment to interest and
   * leaves more principal outstanding — which is what makes bisection valid.
   */
  const remaining = (ratePct: number): number => {
    let balance = principal;
    let periodStart = start;

    for (let i = 0; i < schedule.length; i++) {
      const interest = periodInterest(balance, ratePct, dayCount, periodStart, dueDates[i]!);
      balance -= payments[i]! - interest;
      periodStart = dueDates[i]!;
    }
    return balance;
  };

  // At zero interest every payment is principal. If the loan still is not
  // repaid, the payments are too small and no rate makes them sufficient.
  if (remaining(MIN_RATE_PCT) > 0.01) return null;
  // And if even an absurd rate leaves the loan overpaid, the payments are
  // inconsistent with the principal rather than with the rate.
  if (remaining(MAX_RATE_PCT) < 0) return null;

  let low = MIN_RATE_PCT;
  let high = MAX_RATE_PCT;
  for (let i = 0; i < ITERATIONS; i++) {
    const mid = (low + high) / 2;
    if (remaining(mid) > 0) high = mid;
    else low = mid;
  }
  const impliedRatePct = (low + high) / 2;

  // Rebuild the columns at the rate the payments imply, with the final row
  // taking whatever balance is left so it lands exactly on zero. Every
  // amortisation table does this; the rounding has to go somewhere.
  const rebuilt: PaymentPeriod[] = [];
  let balance = principal;
  let periodStart = start;

  for (let i = 0; i < schedule.length; i++) {
    const last = i === schedule.length - 1;
    const interest = round2(
      periodInterest(balance, impliedRatePct, dayCount, periodStart, dueDates[i]!),
    );
    const part = last ? round2(balance) : round2(payments[i]! - interest);

    rebuilt.push({
      index: schedule[i]!.index,
      dueDate: schedule[i]!.dueDate,
      principal: part,
      interest,
    });

    balance = round2(balance - part);
    periodStart = dueDates[i]!;
  }

  // The whole point of the exercise, asserted rather than assumed.
  const total = rebuilt.reduce((sum, row) => sum + row.principal, 0);
  if (Math.abs(total - principal) > 0.01) return null;

  return { schedule: rebuilt, impliedRatePct };
}
