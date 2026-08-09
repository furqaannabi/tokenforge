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
  currency: field(z.enum(CURRENCIES)),
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
export type ExtractedTerms = z.infer<typeof extractedTermsSchema>;
export type TermField = keyof ExtractedTerms;

export const TERM_FIELDS = Object.keys(
  extractedTermsSchema.shape,
) as TermField[];

/** Human labels, shared with the review UI. */
export const FIELD_LABELS: Record<TermField, string> = {
  borrower: "Borrower",
  lender: "Lender",
  principal: "Principal Amount",
  currency: "Settlement Currency",
  interestRatePct: "Interest Rate",
  dayCount: "Day-Count Convention",
  agreementDate: "Agreement Date",
  maturityDate: "Maturity Date",
  paymentFrequency: "Payment Frequency",
  schedule: "Repayment Schedule",
  covenants: "Covenants",
  latePayment: "Late-Payment Terms",
};
