import type { ExtractedTerms, PaymentPeriod, TermField } from "./schema";

/**
 * Does the extractor agree with itself?
 *
 * Everything else in this package checks an extraction against its own
 * arithmetic: does the schedule sum to the principal, does the interest
 * reproduce the rate, is the maturity after the agreement date. All of that is
 * a check on one answer. None of it can see the failure where the model reads
 * the same document twice and returns two different answers, because each
 * answer on its own may be perfectly self-consistent.
 *
 * That failure is real and it was measured. One agreement, one model, one
 * prompt: the schedule's principal column came to 1,344,330 on one run and
 * 1,500,119 on the next, against a stated principal of 1,500,000. The validator
 * caught the bad run — but it caught it the way a smoke alarm catches a fire in
 * the room it happens to be in. Nothing established that the pipeline would
 * have caught the other one.
 *
 * So the document is read twice, independently, and the two readings are
 * compared here. Where they disagree, the field is not trusted: its confidence
 * is capped and the disagreement becomes its note, which routes it to a human
 * through the same path every other uncertain field takes.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: pick a winner. Averaging two readings
 * invents a third that neither run produced, and choosing the more plausible
 * one is the exact judgement the pipeline exists to avoid making silently. Two
 * readings that disagree mean the value is unknown, and the honest response to
 * an unknown value is to say so.
 */

export interface Disagreement {
  field: TermField;
  /** Names both readings, because which two values differ is the whole point. */
  message: string;
}

/**
 * How far apart two readings may be and still count as the same answer.
 *
 * Visible and named rather than buried at a call site, because these are a
 * claim about the product: money agrees to the cent, and a rate agrees to a
 * thousandth of a percentage point. Neither is a rounding allowance — they
 * exist because the values arrive as IEEE doubles and an exact comparison
 * would flag 1500000.0000000002 against 1500000.
 */
export const AGREEMENT_TOLERANCE = {
  /** One cent. */
  amount: 0.01,
  /** A thousandth of a percentage point. */
  ratePct: 0.001,
} as const;

const money = (value: number) =>
  value.toLocaleString("en-US", { maximumFractionDigits: 2 });

/**
 * Case, and every space.
 *
 * Not merely collapsing runs of whitespace, because the difference these
 * readings actually show is a space in the *middle of a word*. A PDF breaks a
 * line wherever the column ends, and "ENWAVE CORPORATION" printed across a
 * wrap comes back as "EN WAVE CORPORATION" from the text layer — one reading
 * closed the gap and the other did not, and the check reported a lender read
 * two different ways when both had read the same name. Removing all whitespace
 * makes them the one string they always were.
 *
 * Punctuation is deliberately left alone. "Acme Holdings" and "Acme Holdings,
 * LLC" name different legal entities, the note commits to whichever is minted,
 * and no line break invents a comma — so that difference is a reviewer's to
 * judge rather than a normalisation rule's to erase.
 */
const normalize = (value: string) => value.replace(/\s+/g, "").toLowerCase();

const sum = (rows: PaymentPeriod[], key: "principal" | "interest") =>
  rows.reduce((total, row) => total + row[key], 0);

/**
 * Compares two independent readings of the same document.
 *
 * Order does not matter, and neither reading is privileged: this reports that
 * they differ, not which one is right.
 */
export function compareExtractions(
  a: ExtractedTerms,
  b: ExtractedTerms,
): Disagreement[] {
  const found: Disagreement[] = [];
  const differ = (field: TermField, message: string) =>
    found.push({ field, message });

  // Text fields: the parties, and the enumerated ones where any difference at
  // all is a difference in meaning.
  for (const field of ["borrower", "lender"] as const) {
    const first = String(a[field].value);
    const second = String(b[field].value);
    if (normalize(first) !== normalize(second)) {
      differ(field, `read as "${first}" once and "${second}" the second time`);
    }
  }

  for (const field of [
    "dayCount",
    "agreementDate",
    "maturityDate",
    "paymentFrequency",
  ] as const) {
    const first = String(a[field].value);
    const second = String(b[field].value);
    if (first !== second) {
      differ(field, `read as ${first} once and ${second} the second time`);
    }
  }

  const principal = { first: a.principal.value, second: b.principal.value };
  if (Math.abs(principal.first - principal.second) > AGREEMENT_TOLERANCE.amount) {
    differ(
      "principal",
      `read as ${money(principal.first)} once and ${money(principal.second)} the second time`,
    );
  }

  const rate = {
    first: a.interestRatePct.value,
    second: b.interestRatePct.value,
  };
  if (Math.abs(rate.first - rate.second) > AGREEMENT_TOLERANCE.ratePct) {
    differ(
      "interestRatePct",
      `read as ${rate.first}% once and ${rate.second}% the second time`,
    );
  }

  /*
   * The schedule, compared by its totals rather than row by row.
   *
   * A row-by-row diff on a twenty-four period schedule produces twenty-four
   * findings for one underlying mistake, and a reviewer reading that learns
   * less than one who is told the columns do not agree. The three numbers here
   * are the ones a note is actually built from: how many payments, how much
   * principal, how much interest.
   */
  const first = a.schedule.value;
  const second = b.schedule.value;

  if (first.length !== second.length) {
    differ(
      "schedule",
      `built ${first.length} payments once and ${second.length} the second time`,
    );
  } else if (first.length > 0) {
    const reasons: string[] = [];

    /*
     * A cent per row, not a cent overall.
     *
     * A column total is the sum of as many roundings as there are periods, and
     * two runs that round the same amortisation differently can land a few
     * cents apart on a two-year schedule. Flagging that would put a warning on
     * schedules that agree in every way a lender cares about, and a check that
     * cries wolf is one reviewers learn to click past — which costs more than
     * the pennies it was guarding. A genuinely different amortisation misses by
     * orders of magnitude more than this.
     */
    const scheduleTolerance = AGREEMENT_TOLERANCE.amount * first.length;

    for (const column of ["principal", "interest"] as const) {
      const totals = { first: sum(first, column), second: sum(second, column) };
      if (Math.abs(totals.first - totals.second) > scheduleTolerance) {
        reasons.push(
          `the ${column} column came to ${money(totals.first)} once and ${money(totals.second)} the second time`,
        );
      }
    }

    // The last due date is the maturity the schedule itself implies, and it
    // moves independently of the stated maturity when periods are miscounted.
    const last = {
      first: first[first.length - 1]!.dueDate,
      second: second[second.length - 1]!.dueDate,
    };
    if (last.first !== last.second) {
      reasons.push(
        `the final payment fell on ${last.first} once and ${last.second} the second time`,
      );
    }

    if (reasons.length > 0) differ("schedule", reasons.join(", and "));
  }

  return found;
}

/**
 * Caps the confidence of every field the two readings disagreed on.
 *
 * 0.5 rather than 0: the value in hand may well be the right one, and throwing
 * it away would leave a reviewer with nothing to check against the document.
 * What is gone is the basis for trusting it without looking, which is exactly
 * what confidence measures here.
 *
 * The cap is a floor-wards `min`, so a field that was already doubtful for its
 * own reasons does not get promoted by disagreeing.
 */
export function applyDisagreements(
  terms: ExtractedTerms,
  disagreements: readonly Disagreement[],
): ExtractedTerms {
  if (disagreements.length === 0) return terms;

  const flagged = { ...terms } as ExtractedTerms;

  for (const { field, message } of disagreements) {
    const extracted = flagged[field];
    if (!extracted) continue;

    // A fresh field object rather than a write through the shallow copy, which
    // would reach back into the caller's terms and edit the reading this was
    // handed to inspect.
    (flagged[field] as unknown) = {
      ...extracted,
      confidence: Math.min(extracted.confidence, 0.5),
      note: `The document was read twice and the two readings disagreed: ${message}. Check this value against the document rather than accepting it. ${extracted.note ?? ""}`.trim(),
    };
  }

  return flagged;
}
