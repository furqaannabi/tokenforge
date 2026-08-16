import { AnthropicBedrock } from "@anthropic-ai/bedrock-sdk";
import type Anthropic from "@anthropic-ai/sdk";
import { ConfigurationError } from "./errors";

/**
 * The model client: Claude on Amazon Bedrock.
 *
 * The `bedrock-runtime` client rather than Mantle, which is the newer endpoint
 * and would otherwise be the better default. Mantle serves only the latest
 * models and returns 404 for everything else, and this account is not entitled
 * to those — so the endpoint that has the models wins over the one that is
 * tidier. Both speak the Messages API, so the request and response shapes here
 * are the same ones the first-party SDK uses either way.
 *
 * Two things this pipeline needs sit outside any chat-completions shim, and
 * both are native here: a PDF as a first-class input, and a JSON Schema the
 * model is held to.
 */

/**
 * Claude Sonnet 4.6, everywhere, via a cross-region inference profile.
 *
 * The `us.` prefix is not decoration: newer Anthropic models on Bedrock are
 * reachable only through an inference profile, and calling the bare
 * `anthropic.claude-sonnet-4-6` returns a 404 that reads as though the model
 * does not exist. `aws bedrock list-inference-profiles` is the list of what an
 * account can actually invoke — it is shorter than the model catalogue, and
 * the difference is where an afternoon goes.
 *
 * Pinned rather than aliased, and the trade is the same one that applied to
 * the model this replaces: an alias survives a retirement, while a pin means
 * behaviour cannot shift under a pipeline whose whole claim is that the same
 * document yields the same terms. Every extraction records the model that
 * produced it, and both slots stay overridable by environment.
 *
 * A first-party ID like `claude-sonnet-4-6` is not valid here, and this one is
 * not valid there — which is exactly the kind of difference worth keeping in
 * one place.
 */
export const MODEL = process.env.LLM_MODEL ?? "us.anthropic.claude-sonnet-4-6";

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

let client: AnthropicBedrock | undefined;

/**
 * Constructed on first use, not at import.
 *
 * The SDK is happy without credentials and every call would then fail, and
 * building it eagerly once took the whole service down. Uploading a document
 * and reviewing an extraction need no model at all, so absent credentials
 * should fail those endpoints and nothing else.
 */
export function llm(): AnthropicBedrock {
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

    /*
     * Two literal constructions rather than one cast.
     *
     * The SDK overloads this constructor and deprecates the arm that takes a
     * secret without an access key — so a cast that lets the compiler pick for
     * it selects the deprecated overload and warns. Branching keeps each call
     * on a supported arm: both keys, or neither and the AWS provider chain.
     * The pairing is already enforced above, where a clearer error is raised
     * than either the types or the SDK would give.
     *
     * AWS_PROFILE is deliberately not passed: `awsProfile` is a Mantle-only
     * option and the runtime client rejects it. Nothing is lost — the AWS
     * credential chain reads that variable from the environment itself, so
     * naming a profile still works, it just is not this code's business.
     */
    client =
      accessKey && secretKey
        ? new AnthropicBedrock({
            awsRegion: region,
            awsAccessKey: accessKey,
            // The runtime client spells this `awsSecretKey`; Mantle spells the
            // same thing `awsSecretAccessKey`. The wrong one is ignored and the
            // call then fails as unsigned.
            awsSecretKey: secretKey,
            awsSessionToken: value("AWS_SESSION_TOKEN"),
          })
        : // No session token here either: the SDK's no-static-credentials arm
          // forbids one, and rightly — a session token accompanies temporary
          // access keys and means nothing without them. The chain reads it
          // from the environment if it is genuinely part of a role's output.
          new AnthropicBedrock({ awsRegion: region });
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

/**
 * A JSON Schema Bedrock will compile.
 *
 * Constrained decoding supports a subset of JSON Schema, and the rejections
 * are unhelpfully specific — a `minimum` on the confidence field returns
 * "properties maximum, minimum are not supported" and nothing else runs. The
 * unsupported keywords are all *value* constraints rather than shape ones, so
 * dropping them changes what the grammar enforces, not what shape comes back.
 *
 * Nothing is lost: every caller parses the response through the same zod
 * schema afterwards, which still enforces the ranges and lengths. The model is
 * constrained to the right shape; zod is what says a confidence of 1.4 is not
 * a confidence.
 */
const UNSUPPORTED_KEYWORDS = new Set([
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "minItems",
  "maxItems",
  "uniqueItems",
]);

export function bedrockSchema<T>(schema: T): T {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      return Object.fromEntries(
        Object.entries(node as Record<string, unknown>)
          .filter(([key]) => !UNSUPPORTED_KEYWORDS.has(key))
          .map(([key, value]) => [key, walk(value)]),
      );
    }
    return node;
  };
  return walk(schema) as T;
}
