import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { HTTPException } from "hono/http-exception";
import { keccak256, toBytes } from "viem";
import { z } from "zod";
import type { Prisma } from "../generated/prisma/client";
import { prisma } from "./db";
import { ConfigurationError } from "./errors";
import { extractTerms } from "./extract";
import { documentKey, documentUrl, putDocument, storageEnabled } from "./storage";
import {
  extractedTermsSchema,
  fieldsNeedingReview,
  mintGate,
  validateTerms,
  type ExtractedTerms,
  type TermField,
} from "@tokenforge/core";

/**
 * The extraction service.
 *
 * Packaged as three verbs — extract, validate, mint — so an agent can drive the
 * same pipeline the web app does.
 */

/**
 * Prisma's `InputJsonValue` rejects typed arrays and interfaces because they
 * lack an index signature, even when their contents are plainly serialisable.
 * The cast is confined here rather than spread across every write.
 */
const asJson = (value: unknown) => value as Prisma.InputJsonValue;

const app = new Hono();

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: (process.env.CORS_ORIGINS ?? "http://localhost:3000").split(","),
  }),
);

app.get("/health", (c) => c.json({ ok: true, service: "tokenforge-extraction" }));

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

const uploadSchema = z.object({
  filename: z.string().min(1),
  /// Text layer used for extraction. Until PDF parsing exists, the caller
  /// supplies it.
  text: z.string().min(1),
  /// The document itself, base64-encoded. Optional, but without it there is no
  /// file to show a reviewer and nothing to store.
  fileBase64: z.string().nullable().default(null),
  mimeType: z.string().default("application/pdf"),
  uploadedBy: z.string().nullable().default(null),
});

/**
 * Registers a source document, storing the file itself when one is supplied.
 *
 * The hash is keccak256 of the document's own bytes when the file is present,
 * falling back to the text layer when it is not. That distinction matters: the
 * hash is what `NoteFactory` writes on-chain to bind a token to the exact file
 * it was minted from, so it has to be the file's hash and not a hash of some
 * derived text. A text-only upload therefore produces a provenance record that
 * is internally consistent but not verifiable against the original PDF.
 *
 * A re-upload returns the existing document rather than erroring — the same
 * file arriving twice is not a mistake worth blocking on.
 */
app.post("/documents", async (c) => {
  const body = uploadSchema.parse(await c.req.json());

  const fileBytes = body.fileBase64
    ? Uint8Array.from(Buffer.from(body.fileBase64, "base64"))
    : null;

  const hashedBytes = fileBytes ?? toBytes(body.text);
  const contentHash = keccak256(hashedBytes);

  const existing = await prisma.document.findUnique({ where: { contentHash } });
  if (existing) {
    return c.json({ document: existing, alreadyKnown: true });
  }

  // Store before recording. A row pointing at an object that failed to upload
  // is worse than no row at all.
  let storageKey: string | null = null;
  if (fileBytes && storageEnabled) {
    const stored = await putDocument(
      documentKey(contentHash, body.filename),
      fileBytes,
      body.mimeType,
    );
    storageKey = stored.key;
  }

  const document = await prisma.document.create({
    data: {
      filename: body.filename,
      mimeType: body.mimeType,
      text: body.text,
      byteSize: hashedBytes.length,
      contentHash,
      storageKey,
      uploadedBy: body.uploadedBy,
    },
  });

  return c.json({ document, alreadyKnown: false }, 201);
});

/**
 * A short-lived URL for reading the stored document.
 *
 * The bucket stays private — loan agreements are not public, and a signed URL
 * lets the review screen show one without the file being readable by anyone who
 * guesses a hash.
 */
app.get("/documents/:id/url", async (c) => {
  const document = await prisma.document.findUnique({
    where: { id: c.req.param("id") },
  });
  if (!document) throw new HTTPException(404, { message: "Unknown document." });
  if (!document.storageKey) {
    throw new HTTPException(404, {
      message: "This document was registered without a file, so there is nothing to download.",
    });
  }

  return c.json({ url: await documentUrl(document.storageKey) });
});

app.get("/documents", async (c) => {
  const documents = await prisma.document.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      filename: true,
      contentHash: true,
      byteSize: true,
      createdAt: true,
    },
  });
  return c.json({ documents });
});

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Runs the pipeline over a stored document: model extraction, then the
 * deterministic validator, then confidence routing.
 *
 * The resulting status is the honest verdict. INVALID means the numbers
 * contradict each other and no amount of human confirmation will help;
 * NEEDS_REVIEW means they hang together but someone must vouch for a field.
 */
app.post("/documents/:id/extract", async (c) => {
  const document = await prisma.document.findUnique({
    where: { id: c.req.param("id") },
  });
  if (!document) throw new HTTPException(404, { message: "Unknown document." });

  const result = await extractTerms(document.text);
  const validation = validateTerms(result.terms);
  const unreviewed = fieldsNeedingReview(result.terms);

  const status = !validation.consistent
    ? "INVALID"
    : unreviewed.length > 0
      ? "NEEDS_REVIEW"
      : "VALIDATED";

  const extraction = await prisma.extraction.create({
    data: {
      documentId: document.id,
      model: result.model,
      status,
      terms: asJson(result.terms),
      issues: asJson(validation.issues),
      consistent: validation.consistent,
      unreviewedFields: unreviewed,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      latencyMs: result.latencyMs,
    },
  });

  return c.json({ extraction }, 201);
});

app.get("/extractions/:id", async (c) => {
  const extraction = await prisma.extraction.findUnique({
    where: { id: c.req.param("id") },
    include: { document: true, note: true },
  });
  if (!extraction) throw new HTTPException(404, { message: "Unknown extraction." });
  return c.json({ extraction });
});

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

const reviewSchema = z.object({
  /// Corrected values, keyed by field. Omitted fields keep the model's value.
  terms: z.record(z.string(), z.unknown()).optional(),
  /// Field keys a human has explicitly confirmed.
  confirmed: z.array(z.string()).default([]),
  reviewedBy: z.string().nullable().default(null),
});

/**
 * Records a human's corrections and confirmations, then re-runs validation.
 *
 * Re-validating is the point: a reviewer correcting one field can easily break
 * the arithmetic elsewhere, and the corrected terms deserve the same scrutiny
 * the model's did.
 */
app.post("/extractions/:id/review", async (c) => {
  const id = c.req.param("id");
  const body = reviewSchema.parse(await c.req.json());

  const existing = await prisma.extraction.findUnique({ where: { id } });
  if (!existing) throw new HTTPException(404, { message: "Unknown extraction." });

  const merged = mergeTerms(existing.terms as ExtractedTerms, body.terms ?? {});
  const parsed = extractedTermsSchema.safeParse(merged);
  if (!parsed.success) {
    throw new HTTPException(400, {
      message: `Corrected terms do not match the schema: ${parsed.error.message}`,
    });
  }

  const validation = validateTerms(parsed.data);
  const unreviewed = fieldsNeedingReview(parsed.data, new Set(body.confirmed));

  const extraction = await prisma.extraction.update({
    where: { id },
    data: {
      terms: asJson(parsed.data),
      issues: asJson(validation.issues),
      consistent: validation.consistent,
      unreviewedFields: unreviewed,
      status: !validation.consistent
        ? "INVALID"
        : unreviewed.length > 0
          ? "NEEDS_REVIEW"
          : "VALIDATED",
      reviewedAt: new Date(),
      reviewedBy: body.reviewedBy,
    },
  });

  return c.json({ extraction });
});

/** Applies human corrections field by field, marking each as edited. */
function mergeTerms(
  base: ExtractedTerms,
  corrections: Record<string, unknown>,
): ExtractedTerms {
  const merged = structuredClone(base);

  for (const [key, value] of Object.entries(corrections)) {
    if (!(key in merged)) continue;
    const field = merged[key as TermField] as {
      value: unknown;
      note?: string | null;
      editedByHuman?: boolean;
    };

    field.value = value;
    // Marked as human-edited rather than assigned a confidence of 1. Confidence
    // is the model's own estimate of a value it produced, and overwriting it
    // would misreport a person's correction as the model having been certain.
    // `fieldsNeedingReview` treats the flag as vouching for the field.
    field.editedByHuman = true;
    field.note = "Corrected during human review.";
  }

  return merged;
}

// ---------------------------------------------------------------------------
// Minting
// ---------------------------------------------------------------------------

/**
 * Answers whether an extraction may be minted, without minting it.
 *
 * The contracts enforce the same three gates; this exists so the UI can explain
 * a refusal before a wallet is opened, rather than surfacing a bare revert.
 */
app.get("/extractions/:id/mint-gate", async (c) => {
  const extraction = await prisma.extraction.findUnique({
    where: { id: c.req.param("id") },
  });
  if (!extraction) throw new HTTPException(404, { message: "Unknown extraction." });

  const issuerVerified = c.req.query("issuerVerified") === "true";
  // Anything not on the stored unreviewed list has already been vouched for.
  const terms = extraction.terms as ExtractedTerms;
  const confirmed = new Set(
    (Object.keys(terms) as TermField[]).filter(
      (key) => !extraction.unreviewedFields.includes(key),
    ),
  );

  const gate = mintGate(terms, issuerVerified, { confirmed });

  return c.json({ gate });
});

const mintRecordSchema = z.object({
  chainId: z.number(),
  noteAddress: z.string(),
  vaultAddress: z.string(),
  issuerAddress: z.string(),
  txHash: z.string(),
  blockNumber: z.union([z.number(), z.string()]),
  name: z.string(),
  symbol: z.string(),
});

/**
 * Records a mint that already happened on-chain.
 *
 * Deliberately after the fact. This service never holds a key or sends a
 * transaction — the issuer's own wallet signs, and this is the index of what
 * the chain already accepted.
 */
app.post("/extractions/:id/mint", async (c) => {
  const extractionId = c.req.param("id");
  const body = mintRecordSchema.parse(await c.req.json());

  const extraction = await prisma.extraction.findUnique({
    where: { id: extractionId },
  });
  if (!extraction) throw new HTTPException(404, { message: "Unknown extraction." });
  if (!extraction.consistent) {
    throw new HTTPException(409, {
      message: "Refusing to record a mint for terms that failed validation.",
    });
  }

  const note = await prisma.note.create({
    data: {
      extractionId,
      chainId: body.chainId,
      noteAddress: body.noteAddress,
      vaultAddress: body.vaultAddress,
      issuerAddress: body.issuerAddress,
      txHash: body.txHash,
      blockNumber: BigInt(body.blockNumber),
      name: body.name,
      symbol: body.symbol,
    },
  });

  await prisma.extraction.update({
    where: { id: extractionId },
    data: { status: "MINTED" },
  });

  return c.json({ note: { ...note, blockNumber: note.blockNumber.toString() } }, 201);
});

// ---------------------------------------------------------------------------

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }
  if (err instanceof ConfigurationError) {
    // The operator needs to see this one; it is not a client mistake.
    return c.json({ error: err.message }, 503);
  }
  if (err instanceof z.ZodError) {
    return c.json({ error: "Invalid request body.", issues: err.issues }, 400);
  }
  console.error(err);
  return c.json({ error: "Internal error." }, 500);
});

export default {
  port: Number(process.env.PORT ?? 8787),
  fetch: app.fetch,
};
