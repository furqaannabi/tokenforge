import { z } from "zod";

/**
 * The extraction schema.
 *
 * This is both the contract with the model and the shape the review UI renders.
 * Every economic field arrives wrapped in `field()` so a value is never
 * separated from how confident the model was in it, or from the span of source
 * text it came from.
 *
 * Written for OpenAI's structured outputs, which require every property to be
 * present — hence `.nullable()` rather than `.optional()` throughout, and no
 * numeric range keywords. Ranges are enforced by the validator instead, which
 * has to check them anyway for values a human has edited.
 */

/**
 * Settlement currencies a note can pay coupons in.
 *
 * Deliberately not part of `extractedTermsSchema`. Which stablecoin a loan
 * settles in is an issuance decision made when the note is minted, not a fact
 * recorded in the agreement — a paper contract says "$", and asking a model to
 * map that onto a token forces a guess on every document. It guessed, said so,
 * and landed in the review queue every time, which teaches reviewers to click
 * through the queue that exists to make them read.
 */
export const CURRENCIES = ["USDG", "USDC", "USDT"] as const;
export const DAY_COUNTS = ["30/360", "ACT/360", "ACT/365"] as const;
export const PAYMENT_FREQUENCIES = [
  "monthly",
  "quarterly",
  "semiannual",
  "annual",
] as const;

export const COVENANT_KINDS = [
  "financial-reporting",
  "leverage-ratio",
  "negative-pledge",
  "change-of-control",
  "restricted-payments",
] as const;

export const PERIODS_PER_YEAR: Record<PaymentFrequency, number> = {
  monthly: 12,
  quarterly: 4,
  semiannual: 2,
  annual: 1,
};

/**
 * Wraps a value with the model's own account of how sure it was.
 *
 * `sourceQuote` must be verbatim from the document: the review screen finds it
 * by exact string match to highlight the clause a number came from. A
 * paraphrase silently breaks that link, which is why the prompt is emphatic
 * about it.
 */
function field<T extends z.ZodType>(value: T) {
  return z.object({
    value,
    confidence: z
      .number()
      .describe("0 to 1. How certain you are, calibrated honestly."),
    sourceQuote: z
      .string()
      .describe(
        "The exact substring of the document this was read from, copied character for character. Empty string only if genuinely absent.",
      ),
    note: z
      .string()
      .nullable()
      .describe(
        "If confidence is below 0.9, what specifically was ambiguous. Null otherwise.",
      ),
  });
}

export const paymentPeriodSchema = z.object({
  index: z.number().describe("1-indexed period number."),
  dueDate: z.string().describe("ISO date, YYYY-MM-DD."),
  principal: z
    .number()
    .describe("Principal repaid this period. 0 for interest-only periods."),
  interest: z.number().describe("Interest due this period."),
});

export const covenantSchema = z.object({
  kind: z.enum(COVENANT_KINDS),
  text: z.string().describe("The obligation as written in the document."),
});

export const latePaymentSchema = z.object({
  gracePeriodDays: z
    .number()
    .describe("Days after a due date before the note may be flagged impaired."),
  penaltyRatePct: z
    .number()
    .describe("Additional annual rate on overdue amounts, in percent."),
});

export const extractedTermsSchema = z.object({
  borrower: field(z.string()),
  lender: field(z.string()),
  principal: field(z.number()),
  interestRatePct: field(z.number()),
  dayCount: field(z.enum(DAY_COUNTS)),
  agreementDate: field(z.string()),
  maturityDate: field(z.string()),
  paymentFrequency: field(z.enum(PAYMENT_FREQUENCIES)),
  schedule: field(z.array(paymentPeriodSchema)),
  covenants: field(z.array(covenantSchema)),
  latePayment: field(latePaymentSchema),
});

export type Currency = (typeof CURRENCIES)[number];
export type DayCount = (typeof DAY_COUNTS)[number];
export type PaymentFrequency = (typeof PAYMENT_FREQUENCIES)[number];
export type CovenantKind = (typeof COVENANT_KINDS)[number];

export type PaymentPeriod = z.infer<typeof paymentPeriodSchema>;
export type Covenant = z.infer<typeof covenantSchema>;
export type LatePaymentTerms = z.infer<typeof latePaymentSchema>;

/** Exactly what the model returns, before anyone has looked at it. */
export type RawExtractedTerms = z.infer<typeof extractedTermsSchema>;

/**
 * Terms as the application holds them: the model's output plus review state.
 *
 * `editedByHuman` is deliberately absent from the zod schema. It is not
 * something a model reports, and OpenAI's structured outputs require every
 * property to be present — an optional field there is not permitted. Adding it
 * as a mapped type keeps one source of truth for the shape while letting the
 * review flow record who has vouched for what.
 */
export type ExtractedTerms = {
  [K in keyof RawExtractedTerms]: Omit<RawExtractedTerms[K], "note"> & {
    /**
     * Required of the model — it must say something or explicitly null — but
     * optional for terms the application constructs, such as fixtures and
     * hand-entered corrections, which have no model rationale to report.
     */
    note?: string | null;
    editedByHuman?: boolean;
  };
};

export type TermField = keyof ExtractedTerms;

/** One field of the extraction, with its confidence and provenance. */
export type Extracted<T> = {
  value: T;
  confidence: number;
  sourceQuote: string;
  note: string | null;
  editedByHuman?: boolean;
};

export const TERM_FIELDS = Object.keys(
  extractedTermsSchema.shape,
) as TermField[];

/** Human labels, shared with the review UI. */
export const FIELD_LABELS: Record<TermField, string> = {
  borrower: "Borrower",
  lender: "Lender",
  principal: "Principal Amount",
  interestRatePct: "Interest Rate",
  dayCount: "Day-Count Convention",
  agreementDate: "Agreement Date",
  maturityDate: "Maturity Date",
  paymentFrequency: "Payment Frequency",
  schedule: "Repayment Schedule",
  covenants: "Covenants",
  latePayment: "Late-Payment Terms",
};

/**
 * Finds a quoted span in a document, tolerating whitespace differences.
 *
 * A PDF's text layer carries the line breaks of the printed page, so a clause
 * routinely arrives split mid-sentence — or, with a fixed-width render, mid-word.
 * A model quoting that clause reproduces it as prose. Comparing the two
 * literally then fails on documents that are perfectly fine.
 *
 * So whitespace is treated as elastic on both sides: any run of it matches any
 * other, and a break between two characters of a word matches none at all. The
 * document itself is never rewritten — every quote still points at real text,
 * which is what makes the provenance claim worth anything.
 *
 * @returns The `[start, end)` range in `text`, or null when genuinely absent.
 */
export function findQuote(
  text: string,
  quote: string,
): [number, number] | null {
  const trimmed = quote.trim();
  if (!trimmed) return null;

  const exact = text.indexOf(trimmed);
  if (exact !== -1) return [exact, exact + trimmed.length];

  // Every character of the quote, with optional whitespace allowed between
  // each — which covers both a wrapped sentence and a word broken across lines.
  const pattern = trimmed
    .split(/\s+/)
    .map((word) =>
      word
        .split("")
        .map((char) => char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("\\s*"),
    )
    .join("\\s+");

  const match = new RegExp(pattern).exec(text);
  return match ? [match.index, match.index + match[0].length] : null;
}
