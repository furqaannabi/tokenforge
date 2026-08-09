/**
 * The extraction schema.
 *
 * Every economic field the LLM pulls out of a document arrives wrapped in
 * `Extracted<T>` — a value is never separated from how confident the model was
 * in it, or from the span of source text it came from. The review screen needs
 * all three to render, and the validator needs the value alone.
 */

export const CURRENCIES = ["USDG", "USDC", "USDT"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const DAY_COUNTS = ["30/360", "ACT/360", "ACT/365"] as const;
export type DayCount = (typeof DAY_COUNTS)[number];

export const PAYMENT_FREQUENCIES = [
  "monthly",
  "quarterly",
  "semiannual",
  "annual",
] as const;
export type PaymentFrequency = (typeof PAYMENT_FREQUENCIES)[number];

/** Payments per year, used to check the schedule matches the declared cadence. */
export const PERIODS_PER_YEAR: Record<PaymentFrequency, number> = {
  monthly: 12,
  quarterly: 4,
  semiannual: 2,
  annual: 1,
};

/**
 * A single extracted field.
 *
 * `confidence` is 0..1 from the second-pass self-verification call.
 * `sourceQuote` is the verbatim document span, so the review screen can
 * highlight it in the source pane rather than asking the reviewer to hunt.
 * `editedByHuman` flips to true once a reviewer confirms or corrects it, which
 * is what clears a low-confidence field for minting.
 * `note` carries the model's own account of why it was unsure, so the reviewer
 * knows what to look for instead of re-reading the whole document.
 */
export interface Extracted<T> {
  value: T;
  confidence: number;
  sourceQuote: string;
  editedByHuman?: boolean;
  note?: string;
}

export interface PaymentPeriod {
  /** 1-indexed period number. */
  index: number;
  /** ISO date (YYYY-MM-DD) the payment is due. */
  dueDate: string;
  /** Principal repaid this period. Interest-only notes carry 0 until maturity. */
  principal: number;
  interest: number;
}

export type CovenantKind =
  | "financial-reporting"
  | "leverage-ratio"
  | "negative-pledge"
  | "change-of-control"
  | "restricted-payments";

export interface Covenant {
  kind: CovenantKind;
  /** The obligation as written in the document. */
  text: string;
}

export interface LatePaymentTerms {
  /** Days after the due date before the note can be flagged impaired. */
  gracePeriodDays: number;
  /** Additional annual rate charged on overdue amounts, in percent. */
  penaltyRatePct: number;
}

export interface ExtractedTerms {
  borrower: Extracted<string>;
  lender: Extracted<string>;
  principal: Extracted<number>;
  currency: Extracted<Currency>;
  interestRatePct: Extracted<number>;
  dayCount: Extracted<DayCount>;
  agreementDate: Extracted<string>;
  maturityDate: Extracted<string>;
  paymentFrequency: Extracted<PaymentFrequency>;
  schedule: Extracted<PaymentPeriod[]>;
  covenants: Extracted<Covenant[]>;
  latePayment: Extracted<LatePaymentTerms>;
}

/** Field keys that carry a confidence score and can be routed to human review. */
export type TermField = keyof ExtractedTerms;

export interface SourceDocument {
  filename: string;
  /** keccak256 of the file bytes, recorded on-chain by NoteFactory. */
  hash: `0x${string}`;
  /** Rendered document body, used by the review screen's source pane. */
  body: DocumentBlock[];
}

/**
 * A paragraph of the source document. `quotes` are the spans the extractor
 * cited; the review pane highlights them and colours each by the confidence of
 * the field that cited it.
 */
export interface DocumentBlock {
  kind: "title" | "heading" | "paragraph";
  text: string;
}

export type NoteStatus = "draft" | "review" | "live" | "impaired" | "matured";

export interface Note {
  id: string;
  name: string;
  symbol: string;
  status: NoteStatus;
  issuer: Issuer;
  document: SourceDocument;
  terms: ExtractedTerms;
  /** Periods already settled on-chain, by period index. */
  paidPeriods: number[];
  /** Address of the deployed RWANote, once minted. */
  address?: `0x${string}`;
}

export interface Issuer {
  name: string;
  address: `0x${string}`;
  /** Registry membership. Unregistered issuers cannot mint — NoteFactory reverts. */
  verified: boolean;
  jurisdiction: string;
}
