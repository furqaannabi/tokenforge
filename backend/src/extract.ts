import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { extractedTermsSchema, type ExtractedTerms } from "@tokenforge/core";
import { ConfigurationError } from "./errors";

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

/**
 * Gemini through its OpenAI-compatible endpoint.
 *
 * Keeping the OpenAI SDK means the provider is a base URL and a key rather than
 * a rewrite, so switching back — or to anything else speaking the same
 * protocol — is configuration. Note that the compatibility layer exposes
 * `/chat/completions` and not the Responses API, which is why extraction below
 * uses `chat.completions.parse`.
 */
const BASE_URL =
  process.env.LLM_BASE_URL ??
  "https://generativelanguage.googleapis.com/v1beta/openai/";

/**
 * An alias rather than a pinned version, deliberately.
 *
 * `gemini-2.5-pro` was the original default and returns 404: still listed by
 * the models endpoint, but "no longer available to new users". A pinned model
 * fails closed and takes extraction down with it, whereas the alias tracks
 * whatever the current pro model is. The cost is that behaviour can shift
 * without the code changing, which is why every extraction records the model
 * that produced it — set LLM_MODEL to pin one when reproducibility matters
 * more than staying alive.
 */
const MODEL = process.env.LLM_MODEL ?? "gemini-pro-latest";

/**
 * Constructed on first use, not at import.
 *
 * The SDK throws when no key is present, and building it eagerly took the whole
 * service down with it — uploading a document and reviewing an extraction need
 * no model at all. A missing key should fail extraction, nothing else.
 */
let client: OpenAI | undefined;

function llm(): OpenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new ConfigurationError(
        "GEMINI_API_KEY is not set, so terms cannot be extracted. Add it to .env.",
      );
    }
    client = new OpenAI({ apiKey, baseURL: BASE_URL });
  }
  return client;
}

const EXTRACTION_PROMPT = `You extract the economic terms of debt instruments from legal documents: loan agreements, invoices, and bond term sheets.

Rules:

1. Copy sourceQuote verbatim from the document, character for character. It is matched by exact substring to highlight the clause in a review interface, so a paraphrase silently breaks the link. Never invent or normalise a quote.

2. Report confidence honestly and use the whole range. Confidence is not a formality — fields below 0.9 are routed to a human, and that routing is the point. Be specific in the note about what was ambiguous.

   Lower confidence when: the document states a figure two ways, defers to a value it never gives, uses a term of art without defining it, or when you inferred a value rather than read it.

   Do NOT lower confidence merely because a value seems unusual. An 18% rate that the document states plainly is a high-confidence extraction of an expensive loan.

3. Do not silently reconcile contradictions. If clause 2 says 6% and the payment table implies 9.4%, extract the stated rate, give it low confidence, and say so in the note. A downstream validator will catch the inconsistency; your job is to surface it, not to paper over it.

4. Build the schedule from explicit dates in the document where they exist. Only derive dates from a stated cadence when the document gives no table, and lower the schedule's confidence when you do.

5. Dates are ISO YYYY-MM-DD. Rates are percent, so 8.5 means 8.50%. Amounts are plain numbers with no separators or symbols.

6. If a field is genuinely absent, use a neutral value, set confidence near 0, and explain in the note. Never guess to fill a gap.`;

const VERIFICATION_PROMPT = `You are auditing an extraction you just produced, now shown beside the source document.

Re-examine every field and revise confidence to what you would stand behind on a second look. Check specifically:

- Does each sourceQuote appear in the document exactly as written?
- Does the schedule reproduce the stated rate and principal, roughly?
- Does anything in the document contradict the value extracted?
- Was any value inferred rather than read?

Where a check fails, lower that field's confidence and say why in the note. Return the same values unless one is plainly wrong — this pass is about calibrating certainty, not rewriting the extraction. Raising confidence is allowed when a value checks out cleanly.`;

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
    [
      { role: "system", content: EXTRACTION_PROMPT },
      { role: "user", content: documentText },
    ],
    onEvent,
  );

  const draft = first.parsed;
  if (!draft) {
    throw new Error(
      `Extraction returned no parsed output (finish reason: ${first.finishReason}).`,
    );
  }

  onEvent?.({
    type: "stage",
    stage: "auditing",
    message: "Checking the extraction against the source",
  });

  const second = await runPass(
    [
      { role: "system", content: VERIFICATION_PROMPT },
      { role: "user", content: documentText },
      {
        role: "user",
        content: `Extraction to audit:\n\n${JSON.stringify(draft, null, 2)}`,
      },
    ],
    onEvent,
  );

  // A failed audit is not a failed extraction: keep the first pass rather than
  // losing the whole result because the second call came back unparseable.
  const verified = second.parsed ?? draft;

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
 * Streaming is not for speed — the wall time is the same — but for the
 * partial parse. Each delta carries the object as far as it has been read, so
 * fields can be reported the moment they complete rather than a minute later
 * in one lump.
 */
async function runPass(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  onEvent?: (event: ExtractionEvent) => void,
): Promise<{
  parsed: ExtractedTerms | null;
  finishReason: string;
  promptTokens: number;
  completionTokens: number;
}> {
  const stream = llm().chat.completions.stream({
    model: MODEL,
    messages,
    // Built here rather than passed in, so the parsed type flows through
    // instead of widening to unknown at the call site.
    response_format: zodResponseFormat(extractedTermsSchema, "extracted_terms"),
    // A stream omits usage unless asked. Without this the token counts
    // recorded against every extraction are zero, and the cost of running
    // the pipeline becomes unmeasurable.
    stream_options: { include_usage: true },
  });

  const reported = new Set<string>();

  stream.on("content.delta", ({ parsed }) => {
    if (!onEvent || !parsed || typeof parsed !== "object") return;

    for (const [field, raw] of Object.entries(parsed as Record<string, unknown>)) {
      if (reported.has(field)) continue;

      // A field counts as arrived once its confidence has been read: the
      // value alone can still be a half-parsed string.
      const candidate = raw as { value?: unknown; confidence?: unknown };
      if (
        candidate &&
        typeof candidate === "object" &&
        typeof candidate.confidence === "number"
      ) {
        reported.add(field);
        onEvent({
          type: "field",
          field,
          value: candidate.value,
          confidence: candidate.confidence,
        });
      }
    }
  });

  const completion = await stream.finalChatCompletion();

  onEvent?.({
    type: "usage",
    promptTokens: completion.usage?.prompt_tokens ?? 0,
    completionTokens: completion.usage?.completion_tokens ?? 0,
  });

  return {
    parsed: completion.choices[0]?.message.parsed ?? null,
    finishReason: completion.choices[0]?.finish_reason ?? "unknown",
    promptTokens: completion.usage?.prompt_tokens ?? 0,
    completionTokens: completion.usage?.completion_tokens ?? 0,
  };
}

/**
 * Deterministic backstop for rule 1.
 *
 * A quote that is not actually in the document cannot be highlighted, and a
 * model confidently citing text it invented is exactly the failure a reviewer
 * would not catch by eye. Rather than discard the value, we keep it and force
 * the field into human review.
 */
function reconcileQuotes(
  terms: ExtractedTerms,
  documentText: string,
): ExtractedTerms {
  const checked = { ...terms } as ExtractedTerms;

  for (const key of Object.keys(checked) as (keyof ExtractedTerms)[]) {
    const field = checked[key];
    if (!field.sourceQuote) continue;
    if (documentText.includes(field.sourceQuote)) continue;

    // Cap rather than zero it: the value may well be right, but nothing here
    // can confirm where it came from.
    (checked[key] as { confidence: number; note: string | null }).confidence =
      Math.min(field.confidence, 0.5);
    (checked[key] as { note: string | null }).note =
      `Cited source text was not found verbatim in the document, so this value could not be traced to a clause. ${field.note ?? ""}`.trim();
  }

  return checked;
}
