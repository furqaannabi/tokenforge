import { GoogleGenAI } from "@google/genai";
import { ConfigurationError } from "./errors";

/**
 * The model client.
 *
 * Google's own SDK rather than the OpenAI one pointed at a compatibility
 * endpoint. The compatibility layer covers chat completions and no more, and
 * the two things this pipeline actually needs sit outside it: a PDF as a first
 * class input, and a JSON Schema the model is held to. Both are native here.
 */

/**
 * Gemini 3.7 Flash, everywhere.
 *
 * Pinned rather than aliased. The trade is worth naming: an alias survives a
 * model being retired, and `gemini-2.5-pro` did exactly that to an earlier
 * default — still listed by the models endpoint, but 404 to new callers, which
 * takes extraction down with it. A pin fails that way; it also means behaviour
 * cannot shift under a pipeline whose whole claim is that the same document
 * yields the same terms. Every extraction records the model that produced it,
 * and both slots stay overridable by environment.
 */
export const MODEL = process.env.LLM_MODEL ?? "gemini-3.7-flash";

/**
 * The same model for reading-shaped work.
 *
 * There were two slots because the reasoning one was a Pro and paying Pro
 * prices to transcribe was waste. One model for both collapses that.
 */
export const MODEL_FAST = process.env.LLM_MODEL_FAST ?? "gemini-3.7-flash";

let client: GoogleGenAI | undefined;

/**
 * Constructed on first use, not at import.
 *
 * The SDK is happy without a key but every call would fail, and building it
 * eagerly once took the whole service down. Uploading a document and reviewing
 * an extraction need no model at all, so a missing key should fail those
 * endpoints and nothing else.
 */
export function llm(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new ConfigurationError(
        "GEMINI_API_KEY is not set, so documents cannot be read. Add it to .env.",
      );
    }
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

/** A PDF as the SDK wants it. */
export function pdfPart(bytes: Uint8Array) {
  return {
    inlineData: {
      mimeType: "application/pdf",
      data: Buffer.from(bytes).toString("base64"),
    },
  };
}
