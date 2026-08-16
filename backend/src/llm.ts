import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import type Anthropic from "@anthropic-ai/sdk";
import { ConfigurationError } from "./errors";

/**
 * The model client: Claude on Amazon Bedrock.
 *
 * The Mantle client rather than the legacy `bedrock-runtime` InvokeModel path.
 * Mantle speaks the Messages API, so the request and response shapes here are
 * the same ones the first-party SDK uses — the provider is a construction
 * detail rather than a second dialect to maintain.
 *
 * Two things this pipeline needs sit outside any chat-completions shim, and
 * both are native here: a PDF as a first-class input, and a JSON Schema the
 * model is held to.
 */

/**
 * Claude Sonnet 5, everywhere.
 *
 * Pinned rather than aliased, and the trade is the same one that applied to
 * the model this replaces: an alias survives a retirement, while a pin means
 * behaviour cannot shift under a pipeline whose whole claim is that the same
 * document yields the same terms. Every extraction records the model that
 * produced it, and both slots stay overridable by environment.
 *
 * Bedrock model IDs carry an `anthropic.` prefix. A first-party ID like
 * `claude-opus-5` is a 400 here, and the reverse is a 404 on the direct API —
 * which is exactly the kind of difference worth keeping in one place.
 */
export const MODEL = process.env.LLM_MODEL ?? "anthropic.claude-sonnet-5";

/**
 * The same model for reading-shaped work.
 *
 * There were two slots because the reasoning one was once a larger model and
 * paying its prices to transcribe was waste. One model for both collapses
 * that; the slot stays so a cheaper model can be set for transcription
 * without touching the reasoning path.
 */
export const MODEL_FAST = process.env.LLM_MODEL_FAST ?? MODEL;

/**
 * How hard the model works.
 *
 * `effort` replaces the thinking-token budgets this pipeline never used.
 * Extraction is intelligence-sensitive — a misread rate is somebody's money —
 * so it runs high; transcription is reading, and runs low.
 */
export const EFFORT = (process.env.LLM_EFFORT ?? "high") as
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

let client: AnthropicBedrockMantle | undefined;

/**
 * Constructed on first use, not at import.
 *
 * The SDK is happy without credentials and every call would then fail, and
 * building it eagerly once took the whole service down. Uploading a document
 * and reviewing an extraction need no model at all, so absent credentials
 * should fail those endpoints and nothing else.
 */
export function llm(): AnthropicBedrockMantle {
  if (!client) {
    const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
    if (!region) {
      throw new ConfigurationError(
        "AWS_REGION is not set, so documents cannot be read. Add it to .env — Bedrock has no default region.",
      );
    }

    /*
     * Explicit credentials when the environment carries them, the ambient AWS
     * chain when it does not.
     *
     * Blank is the better default in production: a shared profile or an
     * instance role keeps long-lived keys off the box entirely, and hard-coding
     * them here would take that option away. The env vars exist for the case
     * where there is no chain to fall back on.
     *
     * Empty strings are treated as absent rather than passed through — a blank
     * AWS_ACCESS_KEY_ID in a committed .env template would otherwise authenticate
     * as the empty key and fail with a confusing signature error rather than
     * falling through to the profile that would have worked.
     */
    const value = (name: string) => {
      const raw = process.env[name]?.trim();
      return raw ? raw : undefined;
    };

    const accessKey = value("AWS_ACCESS_KEY_ID");
    const secretKey = value("AWS_SECRET_ACCESS_KEY");

    // The SDK requires the pair together; one alone is a misconfiguration
    // worth naming rather than a silent fall-through to the ambient chain.
    if (Boolean(accessKey) !== Boolean(secretKey)) {
      throw new ConfigurationError(
        "AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set together, or both left blank to use the ambient AWS credentials.",
      );
    }

    client = new AnthropicBedrockMantle({
      awsRegion: region,
      awsAccessKey: accessKey,
      awsSecretAccessKey: secretKey,
      awsSessionToken: value("AWS_SESSION_TOKEN"),
      awsProfile: value("AWS_PROFILE"),
    });
  }
  return client;
}

/**
 * A PDF as a document content block.
 *
 * Base64 with no newlines — the wrapped output of some encoders is rejected.
 * The block goes before the accompanying text in the same message, which is
 * the documented ordering and reads better to the model than a question with
 * an attachment trailing after it.
 */
export function pdfBlock(bytes: Uint8Array): Anthropic.DocumentBlockParam {
  return {
    type: "document",
    source: {
      type: "base64",
      media_type: "application/pdf",
      data: Buffer.from(bytes).toString("base64"),
    },
  };
}
