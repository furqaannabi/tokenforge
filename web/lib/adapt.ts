import type { ApiExtraction, ExtractionStatus } from "./api";
import type { DocumentBlock, Note, NoteStatus } from "./types";

/**
 * Turns a service extraction into the shape the review screen renders.
 *
 * The screen was built against local fixtures, which carry a document already
 * split into blocks and an issuer already known. The service stores a flat text
 * layer and knows nothing about wallets, so the gap is closed here rather than
 * by teaching every component to handle two shapes.
 */

const STATUS: Record<ExtractionStatus, NoteStatus> = {
  PENDING: "draft",
  NEEDS_REVIEW: "review",
  INVALID: "review",
  VALIDATED: "review",
  MINTED: "live",
  REJECTED: "draft",
};

/**
 * Splits a text layer into renderable blocks.
 *
 * Deliberately crude: a short all-caps line is a heading, the first is the
 * title, everything else is a paragraph. Real structure would come from the PDF
 * parser that does not exist yet, and inventing more here would only look like
 * it understood the document.
 */
export function textToBlocks(text: string): DocumentBlock[] {
  const lines = text
    .split(/\n{2,}|\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line, index) => {
    const isShout = line.length < 80 && line === line.toUpperCase() && /[A-Z]/.test(line);
    if (index === 0 && isShout) return { kind: "title", text: line };
    if (isShout) return { kind: "heading", text: line };
    return { kind: "paragraph", text: line };
  });
}

export function extractionToNote(
  extraction: ApiExtraction,
  issuerAddress?: `0x${string}`,
): Note {
  const terms = extraction.terms;
  const borrower = terms.borrower.value || "Unnamed Borrower";

  return {
    id: extraction.id,
    name: `${borrower} Note`,
    symbol: symbolFor(borrower),
    status: STATUS[extraction.status],
    issuer: {
      name: borrower,
      // The service does not record who will issue; the connected wallet is
      // the only address in play until the mint is signed.
      address: issuerAddress ?? "0x0000000000000000000000000000000000000000",
      verified: Boolean(issuerAddress),
      jurisdiction: "—",
    },
    document: {
      id: extraction.document?.id,
      filename: extraction.document?.filename ?? "document.pdf",
      hash:
        (extraction.document?.contentHash as `0x${string}`) ??
        ("0x" as `0x${string}`),
      body: textToBlocks(extraction.document?.text ?? ""),
    },
    terms,
    // Not part of the extraction: the issuer picks it on the review screen
    // before minting. USDG is the default on X Layer.
    currency: "USDG",
    paidPeriods: [],
    address: extraction.note?.noteAddress,
  };
}

/** First letters of the borrower's name, plus the year it matures. */
function symbolFor(borrower: string): string {
  const letters = borrower
    .replace(/[^A-Za-z ]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((word) => word[0]!.toUpperCase())
    .join("");
  return letters || "NOTE";
}
