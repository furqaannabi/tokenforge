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
 * An alias rather than a pinned version, deliberately.
 *
 * `gemini-2.5-pro` was an earlier default and returns 404: still listed by the
 * models endpoint, but "no longer available to new users". A pinned model fails
 * closed and takes extraction down with it. The cost is that behaviour can
 * shift without the code changing, which is why every extraction records the
 * model that produced it — set LLM_MODEL to pin one when reproducibility
 * matters more than staying alive.
 */
export const MODEL = process.env.LLM_MODEL ?? "gemini-pro-latest";

/** For work that is reading rather than reasoning, such as transcription. */
export const MODEL_FAST = process.env.LLM_MODEL_FAST ?? "gemini-flash-latest";

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
