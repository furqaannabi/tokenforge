/**
 * Maps extracted fields back onto the source document.
 *
 * Every field carries the verbatim span it was read from. Splitting each
 * paragraph around those spans is what lets the review pane show the reviewer
 * *where* a number came from, rather than asking them to take the value on
 * faith and hunt through the PDF themselves.
 */

import type { ExtractedTerms, TermField } from "./types";
import { LOW_CONFIDENCE_THRESHOLD } from "./validator";

export type HighlightTone = "verified" | "review";

export interface Highlight {
  field: TermField;
  quote: string;
  tone: HighlightTone;
}

export interface Segment {
  text: string;
  field?: TermField;
  tone?: HighlightTone;
}

/**
 * One highlight per field that cited a non-empty span, toned by whether the
 * extraction cleared the review threshold.
 */
export function highlightsFor(terms: ExtractedTerms): Highlight[] {
  return (Object.keys(terms) as TermField[])
    .map((field) => {
      const extracted = terms[field];
      return {
        field,
        quote: extracted.sourceQuote,
        tone: (extracted.confidence < LOW_CONFIDENCE_THRESHOLD &&
        !extracted.editedByHuman
          ? "review"
          : "verified") as HighlightTone,
      };
    })
    .filter((highlight) => highlight.quote.length > 0);
}

/**
 * Splits one paragraph into plain and highlighted segments.
 *
 * Longest quotes are matched first so a field citing a whole clause wins over
 * one citing a few words inside it; overlaps after that are dropped rather than
 * nested, since a character can only belong to one field.
 */
export function segmentBlock(text: string, highlights: Highlight[]): Segment[] {
  const matches: Array<{ start: number; end: number; highlight: Highlight }> =
    [];

  const byLength = [...highlights].sort(
    (a, b) => b.quote.length - a.quote.length,
  );

  for (const highlight of byLength) {
    const start = text.indexOf(highlight.quote);
    if (start === -1) continue;
    const end = start + highlight.quote.length;

    const overlaps = matches.some(
      (match) => start < match.end && end > match.start,
    );
    if (overlaps) continue;

    matches.push({ start, end, highlight });
  }

  if (matches.length === 0) return [{ text }];

  matches.sort((a, b) => a.start - b.start);

  const segments: Segment[] = [];
  let cursor = 0;

  for (const match of matches) {
    if (match.start > cursor) {
      segments.push({ text: text.slice(cursor, match.start) });
    }
    segments.push({
      text: text.slice(match.start, match.end),
      field: match.highlight.field,
      tone: match.highlight.tone,
    });
    cursor = match.end;
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor) });
  }

  return segments;
}
