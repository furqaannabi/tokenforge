import { z } from "zod";
import {
  applyDisagreements,
  compareExtractions,
  extractedTermsSchema,
  findQuote,
  type Disagreement,
  type ExtractedTerms,
} from "@tokenforge/core";
import { bedrockSchema, EFFORT, MODEL, llm } from "./llm";

/**
 * The AI core: a legal document in, economic terms with per-field confidence
 * out.
 *
 * Three passes, in two shapes.
 *
 * The document is read twice, independently and concurrently — same prompt,
 * same model, neither run aware of the other. Then one of the readings is shown
 * back to the model beside the source and audited: a single pass produces
 * uniformly high confidence, because a model asked for a number and a certainty
 * in the same breath tends to justify the number it just wrote, and the audit
 * has something concrete to disagree with.
 *
 * The two shapes catch different failures, which is why both are here. The
 * audit catches a reading that contradicts the document. The rerun catches a
 * reading that contradicts *the model itself* — a document the extractor is
 * simply not stable on, where each answer is internally tidy and they are not
 * the same answer. No amount of auditing one reading reveals that.
 *
 * Nothing here decides whether terms are mintable. That is the validator's job,
 * and it ignores these scores entirely.
 */

/**
 * Reading twice is the default, and can be turned off.
 *
 * It roughly doubles the input tokens for the reading stage — pennies per
 * document, and no wall-clock cost since the two run concurrently — but this
 * pipeline reports its own cost and someone batching thousands of agreements
 * deserves the choice. Off means the disagreement check simply does not run;
 * it does not mean disagreements are ignored.
 */
const CROSSCHECK = process.env.EXTRACT_CROSSCHECK !== "off";

const EXTRACTION_PROMPT = `You extract the economic terms of debt instruments from legal documents: loan agreements, invoices, and bond term sheets.

Rules:

1. Copy sourceQuote verbatim from the document, character for character. It is matched against the document to highlight the clause in a review interface, so a paraphrase silently breaks the link. Never invent or normalise a quote.

2. Confidence is a claim about how the value was obtained, not about how plausible it looks. Fields below 0.9 are routed to a human, and that routing is the point.

   Reserve 1.0 for a value you copied from a single unambiguous clause — a stated principal, a stated rate, a stated date. If you assembled the value from several places, derived it from a cadence, normalised it into a different form, or judged which of two readings was meant, it does not belong at 1.0 however confident you feel. A twelve-row schedule built from a list of dates is assembled work; so is a covenant list gathered from a section.

   Use 0.9 to 0.99 for a value read from one place but requiring interpretation. Use 0.5 to 0.9 where the document is ambiguous, states a figure two ways, or defers to a value it never gives. Below 0.5 where you inferred rather than read.

   Do NOT lower confidence merely because a value seems unusual. An 18% rate that the document states plainly is a high-confidence extraction of an expensive loan.

3. Do not silently reconcile contradictions. If clause 2 says 6% and the payment table implies 9.4%, extract the stated rate, give it low confidence, and say so in the note. A downstream validator will catch the inconsistency; your job is to surface it, not to paper over it.

4. Build the schedule from explicit dates in the document where they exist. Only derive dates from a stated cadence when the document gives no table, and lower the schedule's confidence when you do.

5. A stated instalment is usually a blended payment: it covers the interest accrued that period, and whatever is left reduces the principal. When a document gives one figure — "24 equal monthly instalments of $67,840.94" — never copy that figure into the principal column. Two arithmetic facts settle the split and neither is negotiable: total interest is the instalments minus the principal (24 x 67,840.94 against a principal of 1,500,000 leaves 128,182.56 of interest across the whole schedule, and no other figure is possible), and the principal column sums to the stated principal exactly, with the balance reaching zero on the final row. Work period by period: interest is the outstanding balance times the periodic rate — the annual rate divided by the periods in a year, not the annual rate itself — and the rest of the instalment reduces the balance. Derive the interest from the instalments rather than from the rate: when a stated rate and a stated instalment disagree, the instalment is what the borrower actually pays. If your columns do not satisfy both facts, your periodic rate is wrong.

6. Maturity is the date of the final scheduled payment. N payments starting on a given date end N-1 periods later, not N: twenty-four monthly payments beginning 1 April 2026 end on 1 March 2028. Take maturity from the last row of the schedule you built so the two cannot disagree — unless the document states a maturity of its own, in which case extract the stated one and note that it contradicts the schedule.

5. Dates are ISO YYYY-MM-DD. Rates are percent, so 8.5 means 8.50%. Amounts are plain numbers with no separators or symbols.

6. If a field is genuinely absent, use a neutral value, set confidence near 0, and explain in the note. Never guess to fill a gap.

7. Line breaks in the text come from the printed page rather than the document's meaning: a clause can wrap mid-sentence, and a word can be split across two lines. Read through those breaks — a name broken over a line is one name, not two words.

   This affects the value, not the quote. Give the value as the document reads, while sourceQuote stays copied from the text in front of you, line break included. Quotes are matched allowing for whitespace, so a wrapped quote still resolves. Do not lower confidence for a break you were able to read through.`;

const VERIFICATION_PROMPT = `You are auditing an extraction you just produced, now shown beside the source document.

Re-examine every field and revise confidence to what you would stand behind on a second look. Check specifically:

- Does each sourceQuote appear in the document exactly as written?
- Does the schedule reproduce the stated rate and principal, roughly?
- Does the principal column sum to the stated principal? Falling short by roughly the total interest means a blended instalment was copied in whole instead of split.
- Does the last row's date equal the maturity date? An off-by-one in counting periods shows up here.
- Does anything in the document contradict the value extracted?
- Was any value inferred rather than read?

Then apply the standard for 1.0 strictly, because the first pass tends not to. 1.0 means the value was copied from a single unambiguous clause and nothing was decided. Anything assembled from several places, derived from a stated cadence, normalised into another form, or chosen between two readings caps at 0.99 no matter how sure it seems — a schedule built from a list of dates and a covenant list gathered from a section are both assembled work.

A pass that returns every field at 1.0 has not audited anything. If that is what you are about to do, look again at which values you actually constructed rather than read.

Where a check fails, lower that field's confidence and say why in the note. Return the same values unless one is plainly wrong — this pass is about calibrating certainty, not rewriting the extraction. Raising confidence is allowed when a value checks out cleanly.`;

/**
 * The schema the model is held to.
 *
 * zod is already the source of truth for this shape and emits JSON Schema
 * directly, so the contract with the model cannot drift from the type the rest
 * of the code uses.
 */
/*
 * Two fields are left out of the enforced schema, and it is a real trade.
 *
 * Bedrock compiles a grammar from the schema to constrain decoding, and it
 * refuses one this size: eleven fields fails, nine passes, and it is the
 * structure rather than the text — stripping every description halved the
 * bytes and changed nothing. So enforcement is spent where it earns most.
 *
 * `covenants` and `latePayment` are the two that go. They are the same two
 * that do not gate a mint: neither has an editor in the review screen, and
 * neither enters the mint hash. Everything the contract commits to — the
 * parties, the money, the dates, the schedule — is still enforced.
 *
 * They come back as unextracted rather than invented, at confidence zero, so
 * the interface shows them as unknown instead of quietly asserting a loan has
 * no covenants. Restoring them means a second call carrying the document
 * again, which is pennies but is not free.
 */
const UNENFORCED = ["covenants", "latePayment"] as const;

const responseJsonSchema = (() => {
  const full = z.toJSONSchema(extractedTermsSchema) as {
    properties: Record<string, unknown>;
    required?: string[];
  };
  const properties = Object.fromEntries(
    Object.entries(full.properties).filter(
      ([key]) => !UNENFORCED.includes(key as (typeof UNENFORCED)[number]),
    ),
  );
  return bedrockSchema({
    ...full,
    properties,
    required: Object.keys(properties),
  });
})();

/** What an omitted field looks like: absent, and saying so. */
function unextracted<T>(value: T) {
  return {
    value,
    confidence: 0,
    sourceQuote: "",
    note: "Not extracted: this field is outside the enforced schema.",
  };
}

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
  /**
   * Fields the two readings did not agree on, already reflected in `terms` as
   * capped confidence. Returned as well so a caller can report the reason
   * rather than only its effect.
   */
  disagreements: Disagreement[];
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

  /*
   * One stage, whether or not the document is read twice.
   *
   * The reviewer is waiting on terms, and how many calls produce them is this
   * file's business rather than theirs. "Reading it twice" invites the
   * question of which reading they are about to be shown, when the answer that
   * matters — the two disagreed about this field — arrives on the field
   * itself, where it can be acted on.
   */
  onEvent?.({
    type: "stage",
    stage: "extracting",
    message: "Reading the document",
  });

  const readingPrompt = `${EXTRACTION_PROMPT}\n\n--- DOCUMENT ---\n\n${documentText}`;

  /*
   * Concurrent, and only the first reports progress.
   *
   * Running them in sequence would double the wait for no benefit — neither
   * reading depends on the other, and that independence is the whole point.
   * Both streaming into `onEvent` would interleave two sets of fields into one
   * progress display and show the reviewer values flickering between readings
   * before either is settled.
   */
  const [first, rerun] = await Promise.all([
    runPass(readingPrompt, onEvent),
    CROSSCHECK ? runPass(readingPrompt) : undefined,
  ]);

  if (!first.parsed) {
    throw new Error("Extraction returned no parsable output.");
  }

  /*
   * A rerun that failed to parse is not a disagreement.
   *
   * There is nothing to compare against, so the check simply did not run — and
   * reporting "the two readings disagreed" because the second one came back as
   * broken JSON would put a false reason in front of a reviewer and send them
   * looking at a document that was read fine.
   */
  const disagreements = rerun?.parsed
    ? compareExtractions(first.parsed, rerun.parsed)
    : [];

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

  /*
   * The disagreements are applied last, after the audit.
   *
   * The audit is allowed to raise confidence on a value that checks out, and
   * it is auditing only one of the two readings — so it has no idea the other
   * one said something different. Capping before it runs would let it undo the
   * cap for exactly the reason the cap exists.
   */
  return {
    terms: applyDisagreements(
      reconcileQuotes(verified, documentText),
      disagreements,
    ),
    model: MODEL,
    promptTokens:
      first.promptTokens + second.promptTokens + (rerun?.promptTokens ?? 0),
    completionTokens:
      first.completionTokens +
      second.completionTokens +
      (rerun?.completionTokens ?? 0),
    latencyMs: Date.now() - startedAt,
    disagreements,
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
  const stream = llm().messages.stream({
    model: MODEL,
    // Room for the whole terms object plus the thinking that precedes it. A
    // truncated extraction parses as invalid JSON and reads as a model failure
    // rather than a budget one.
    max_tokens: 16000,
    output_config: {
      effort: EFFORT,
      // The schema is enforced, not requested. Everything downstream — the
      // validator, the review pane, the mint hash — assumes these fields exist
      // and are typed.
      format: { type: "json_schema", schema: responseJsonSchema },
    },
    messages: [{ role: "user", content: prompt }],
  });

  let text = "";
  let promptTokens = 0;
  let completionTokens = 0;
  const reported = new Set<string>();

  for await (const event of stream) {
    /*
     * Text deltas only. Thinking arrives on this stream too, and folding it
     * into the buffer would corrupt the JSON being assembled — the field
     * scanner below would then announce fields out of the model's reasoning
     * rather than out of its answer.
     */
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      text += event.delta.text;
      if (onEvent) reportCompletedFields(text, reported, onEvent);
    }
  }

  const final = await stream.finalMessage();
  promptTokens = final.usage.input_tokens;
  completionTokens = final.usage.output_tokens;

  if (final.stop_reason === "refusal") {
    throw new Error(
      "The model declined to read this document, so no terms were extracted.",
    );
  }
  if (final.stop_reason === "max_tokens") {
    throw new Error(
      "The document is longer than one extraction pass. Raise max_tokens or split it.",
    );
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
    const raw = JSON.parse(text) as Record<string, unknown>;

    // The model was never asked for these, so supply them before validating
    // rather than letting the schema reject a response that is exactly what
    // was requested.
    raw.covenants ??= unextracted([]);
    raw.latePayment ??= unextracted({ penaltyRatePct: 0, gracePeriodDays: 0 });

    const parsed = extractedTermsSchema.safeParse(raw);
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
