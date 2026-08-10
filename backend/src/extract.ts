import { z } from "zod";
import {
  extractedTermsSchema,
  findQuote,
  type ExtractedTerms,
} from "@tokenforge/core";
import { MODEL, llm } from "./llm";

/**
 * The AI core: a legal document in, economic terms with per-field confidence
 * out.
 *
 * Two passes. The first reads the document; the second is shown its own output
 * beside the source and asked to revise the confidence scores. A single pass
 * produces uniformly high confidence, because a model asked for a number and a
 * certainty in the same breath tends to justify the number it just wrote. The
 * second pass has something concrete to disagree with.
 *
 * Nothing here decides whether terms are mintable. That is the validator's job,
 * and it ignores these scores entirely.
 */

const EXTRACTION_PROMPT = `You extract the economic terms of debt instruments from legal documents: loan agreements, invoices, and bond term sheets.

Rules:

1. Copy sourceQuote verbatim from the document, character for character. It is matched against the document to highlight the clause in a review interface, so a paraphrase silently breaks the link. Never invent or normalise a quote.

2. Report confidence honestly and use the whole range. Confidence is not a formality — fields below 0.9 are routed to a human, and that routing is the point. Be specific in the note about what was ambiguous.

   Lower confidence when: the document states a figure two ways, defers to a value it never gives, uses a term of art without defining it, or when you inferred a value rather than read it.

   Do NOT lower confidence merely because a value seems unusual. An 18% rate that the document states plainly is a high-confidence extraction of an expensive loan.

3. Do not silently reconcile contradictions. If clause 2 says 6% and the payment table implies 9.4%, extract the stated rate, give it low confidence, and say so in the note. A downstream validator will catch the inconsistency; your job is to surface it, not to paper over it.

4. Build the schedule from explicit dates in the document where they exist. Only derive dates from a stated cadence when the document gives no table, and lower the schedule's confidence when you do.

5. Dates are ISO YYYY-MM-DD. Rates are percent, so 8.5 means 8.50%. Amounts are plain numbers with no separators or symbols.

6. If a field is genuinely absent, use a neutral value, set confidence near 0, and explain in the note. Never guess to fill a gap.

7. Line breaks in the text come from the printed page rather than the document's meaning: a clause can wrap mid-sentence, and a word can be split across two lines. Read through those breaks — a name broken over a line is one name, not two words.

   This affects the value, not the quote. Give the value as the document reads, while sourceQuote stays copied from the text in front of you, line break included. Quotes are matched allowing for whitespace, so a wrapped quote still resolves. Do not lower confidence for a break you were able to read through.`;

const VERIFICATION_PROMPT = `You are auditing an extraction you just produced, now shown beside the source document.

Re-examine every field and revise confidence to what you would stand behind on a second look. Check specifically:

- Does each sourceQuote appear in the document exactly as written?
- Does the schedule reproduce the stated rate and principal, roughly?
- Does anything in the document contradict the value extracted?
- Was any value inferred rather than read?

Where a check fails, lower that field's confidence and say why in the note. Return the same values unless one is plainly wrong — this pass is about calibrating certainty, not rewriting the extraction. Raising confidence is allowed when a value checks out cleanly.`;

/**
 * The schema the model is held to.
 *
 * zod is already the source of truth for this shape and emits JSON Schema
 * directly, so the contract with the model cannot drift from the type the rest
 * of the code uses.
 */
const responseJsonSchema = z.toJSONSchema(extractedTermsSchema);

/**
 * Progress from a streaming extraction.
 *
 * `field` fires as each term finishes parsing, which is what makes the wait
 * legible: a reviewer watches the document resolve into terms instead of
 * staring at a spinner for a minute.
 */
export type ExtractionEvent =
  | { type: "stage"; stage: "extracting" | "auditing" | "validating"; message: string }
  | { type: "field"; field: string; value: unknown; confidence: number }
  | { type: "usage"; promptTokens: number; completionTokens: number };

export interface ExtractionResult {
  terms: ExtractedTerms;
  model: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
}

/**
 * @param documentText Text layer of the source document.
 * @param onEvent Optional progress sink. Extraction takes about a minute
 *        across two model passes, so a caller that can report progress should.
 */
export async function extractTerms(
  documentText: string,
  onEvent?: (event: ExtractionEvent) => void,
): Promise<ExtractionResult> {
  const startedAt = Date.now();

  onEvent?.({
    type: "stage",
    stage: "extracting",
    message: "Reading the document",
  });

  const first = await runPass(
    `${EXTRACTION_PROMPT}\n\n--- DOCUMENT ---\n\n${documentText}`,
    onEvent,
  );

  if (!first.parsed) {
    throw new Error("Extraction returned no parsable output.");
  }

  onEvent?.({
    type: "stage",
    stage: "auditing",
    message: "Checking the extraction against the source",
  });

  const second = await runPass(
    `${VERIFICATION_PROMPT}\n\n--- DOCUMENT ---\n\n${documentText}\n\n--- EXTRACTION TO AUDIT ---\n\n${JSON.stringify(first.parsed, null, 2)}`,
    onEvent,
  );

  // A failed audit is not a failed extraction: keep the first pass rather than
  // losing the whole result because the second came back unparseable.
  const verified = second.parsed ?? first.parsed;

  onEvent?.({
    type: "stage",
    stage: "validating",
    message: "Checking the terms are internally consistent",
  });

  return {
    terms: reconcileQuotes(verified, documentText),
    model: MODEL,
    promptTokens: first.promptTokens + second.promptTokens,
    completionTokens: first.completionTokens + second.completionTokens,
    latencyMs: Date.now() - startedAt,
  };
}

/**
 * One model pass, streamed.
 *
 * Streaming is not for speed — the wall time is the same — but so that fields
 * can be reported as they land rather than a minute later in one lump.
 */
async function runPass(
  prompt: string,
  onEvent?: (event: ExtractionEvent) => void,
): Promise<{
  parsed: ExtractedTerms | null;
  promptTokens: number;
  completionTokens: number;
}> {
  const stream = await llm().models.generateContentStream({
    model: MODEL,
    contents: prompt,
    config: { responseMimeType: "application/json", responseJsonSchema },
  });

  let text = "";
  let promptTokens = 0;
  let completionTokens = 0;
  const reported = new Set<string>();

  for await (const chunk of stream) {
    text += chunk.text ?? "";

    if (chunk.usageMetadata) {
      promptTokens = chunk.usageMetadata.promptTokenCount ?? promptTokens;
      completionTokens =
        chunk.usageMetadata.candidatesTokenCount ?? completionTokens;
    }

    if (onEvent) reportCompletedFields(text, reported, onEvent);
  }

  onEvent?.({ type: "usage", promptTokens, completionTokens });

  return { parsed: parseTerms(text), promptTokens, completionTokens };
}

/**
 * Reports fields from a JSON document that is still arriving.
 *
 * The response streams as text, so the object is incomplete for most of the
 * call. Rather than parse partial JSON, this scans for whole `"field": { … }`
 * blocks whose braces have balanced: a field is announced once it can be read
 * in full, which is exactly when it is worth showing.
 */
function reportCompletedFields(
  text: string,
  reported: Set<string>,
  onEvent: (event: ExtractionEvent) => void,
): void {
  const pattern = /"(\w+)"\s*:\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const field = match[1]!;
    if (reported.has(field)) continue;

    const block = readBalancedObject(text, match.index + match[0].length - 1);
    if (!block) continue;

    try {
      const value = JSON.parse(block) as { value?: unknown; confidence?: unknown };
      if (typeof value.confidence !== "number") continue;

      reported.add(field);
      onEvent({
        type: "field",
        field,
        value: value.value,
        confidence: value.confidence,
      });
    } catch {
      // Balanced braces but not yet valid JSON; it will be next time round.
    }
  }
}

/** The `{ … }` starting at `open`, or null if it has not closed yet. */
function readBalancedObject(text: string, open: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = open; i < text.length; i++) {
    const char = text[i]!;

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }

  return null;
}

function parseTerms(text: string): ExtractedTerms | null {
  try {
    const parsed = extractedTermsSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Deterministic backstop for rule 1.
 *
 * A quote that is not actually in the document cannot be highlighted, and a
 * model confidently citing text it invented is exactly the failure a reviewer
 * would not catch by eye. Rather than discard the value, keep it and force the
 * field into human review.
 */
function reconcileQuotes(
  terms: ExtractedTerms,
  documentText: string,
): ExtractedTerms {
  const checked = { ...terms } as ExtractedTerms;

  for (const key of Object.keys(checked) as (keyof ExtractedTerms)[]) {
    const field = checked[key];
    if (!field.sourceQuote) continue;
    // Whitespace-tolerant: a PDF wraps clauses at the page edge, and a quote
    // split across a line is still a real citation.
    if (findQuote(documentText, field.sourceQuote)) continue;

    // Cap rather than zero it: the value may well be right, but nothing here
    // can confirm where it came from.
    (checked[key] as { confidence: number }).confidence = Math.min(
      field.confidence,
      0.5,
    );
    (checked[key] as { note: string | null }).note =
      `Cited source text was not found in the document, so this value could not be traced to a clause. ${field.note ?? ""}`.trim();
  }

  return checked;
}
