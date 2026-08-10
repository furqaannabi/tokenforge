/**
 * Application types.
 *
 * The extraction schema itself lives in `@tokenforge/core` and is shared with
 * the extraction service, so a reviewer's browser and the server cannot
 * disagree about what a set of terms means or whether it may be minted. What
 * remains here is the shape of the app's own world — documents on screen,
 * issuers, and the lifecycle of a note — which the service has no opinion on.
 */

export {
  CURRENCIES,
  DAY_COUNTS,
  PAYMENT_FREQUENCIES,
  PERIODS_PER_YEAR,
  COVENANT_KINDS,
  TERM_FIELDS,
  FIELD_LABELS,
} from "@tokenforge/core";

export type {
  Currency,
  DayCount,
  PaymentFrequency,
  CovenantKind,
  Covenant,
  LatePaymentTerms,
  PaymentPeriod,
  Extracted,
  ExtractedTerms,
  TermField,
} from "@tokenforge/core";

export interface SourceDocument {
  /** Service-side id, used to resolve a URL for the stored PDF. */
  id?: string;
  filename: string;
  /** keccak256 of the file bytes, recorded on-chain by NoteFactory. */
  hash: `0x${string}`;
  /** Rendered document body, used by the review screen's source pane. */
  body: DocumentBlock[];
}

/**
 * A paragraph of the source document. The review pane highlights the spans
 * each field cited and colours them by that field's confidence.
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
  terms: import("@tokenforge/core").ExtractedTerms;
  /**
   * Settlement currency, chosen at issuance rather than read from the
   * document. A paper agreement says "$"; which stablecoin it pays in is the
   * issuer's decision at mint time.
   */
  currency: import("@tokenforge/core").Currency;
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
