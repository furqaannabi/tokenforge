import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { streamSSE } from "hono/streaming";
import { HTTPException } from "hono/http-exception";
import { keccak256, toBytes } from "viem";
import { z } from "zod";
import { Prisma } from "../generated/prisma/client";
import { prisma } from "./db";
import { ConfigurationError } from "./errors";
import { extractTerms } from "./extract";
import { NoTextLayerError, extractPdfText } from "./pdf";
import { transcribePdf } from "./ocr";
import { issuers } from "./issuers";
import { checkProvenance } from "./provenance";
import { readParty } from "./chain";
import { ask, loadHistory } from "./zoya";
import { isAddress } from "viem";
import {
  documentKey,
  documentUrl,
  putDocument,
  storageEnabled,
} from "./storage";
import {
  extractedTermsSchema,
  fieldsNeedingReview,
  mintGate,
  buildMintArgs,
  hashMintArgs,
  CURRENCIES,
  type ProvenanceVerdict,
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

/**
 * Makes a Prisma row safe to serialise.
 *
 * `Note.blockNumber` is a BigInt, and `JSON.stringify` refuses to encode one —
 * so any response carrying a note threw, which meant recording a mint silently
 * broke every later read of that extraction. Converting to a string keeps the
 * value exact; a block number is well past what a JS number holds precisely,
 * which is why it is a BigInt in the first place.
 */
function jsonSafe<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, item) =>
      typeof item === "bigint" ? item.toString() : item,
    ),
  ) as T;
}

const app = new Hono();

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: (process.env.CORS_ORIGINS ?? "http://localhost:3000").split(","),
  }),
);

app.get("/health", (c) => c.json({ ok: true, service: "tokenforge-extraction" }));

// Issuer onboarding. Applications only — admission is signed on-chain by the
// registry admin's own wallet, never by this service.
app.route("/issuers", issuers);

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

const uploadSchema = z.object({
  filename: z.string().min(1),
  /// Text layer used for extraction. Read from the PDF when one is uploaded,
  /// so a caller only supplies this for formats we cannot parse.
  text: z.string().default(""),
  mimeType: z.string().default("application/pdf"),
  uploadedBy: z.string().nullable().default(null),
});

/**
 * Reads the upload as either multipart or JSON.
 *
 * Multipart is the real path: the client posts the file itself, which travels
 * as bytes rather than base64 and costs a third less to send. JSON without a
 * file stays supported for text-only registration and for scripted callers
 * that have no document to hand.
 */
async function readUpload(c: Context): Promise<{
  body: z.infer<typeof uploadSchema>;
  fileBytes: Uint8Array | null;
}> {
  const contentType = c.req.header("content-type") ?? "";

  if (!contentType.includes("multipart/form-data")) {
    return { body: uploadSchema.parse(await c.req.json()), fileBytes: null };
  }

  const form = await c.req.parseBody();
  const file = form.file;
  if (!(file instanceof File)) {
    throw new HTTPException(400, {
      message: "multipart upload requires a 'file' part.",
    });
  }

  const body = uploadSchema.parse({
    filename: (form.filename as string) || file.name,
    text: form.text,
    mimeType: file.type || (form.mimeType as string) || "application/pdf",
    uploadedBy: (form.uploadedBy as string) || null,
  });

  return {
    body,
    fileBytes: new Uint8Array(await file.arrayBuffer()),
  };
}

/**
 * The text a model will read.
 *
 * Parsed from the PDF when one was uploaded, because asking a person to paste
 * the contents of the document they just handed over is not a product. A
 * caller-supplied value still wins: it is the escape hatch for formats this
 * cannot parse, and for a scan whose text came from somewhere else.
 */
async function resolveText(
  body: z.infer<typeof uploadSchema>,
  fileBytes: Uint8Array | null,
): Promise<string> {
  if (body.text.trim()) return body.text;

  if (!fileBytes) {
    throw new HTTPException(400, {
      message: "Provide a file to parse, or the text layer directly.",
    });
  }

  if (!body.mimeType.includes("pdf")) {
    // Anything else that arrived as bytes is almost certainly already text.
    return new TextDecoder().decode(fileBytes);
  }

  try {
    const parsed = await extractPdfText(fileBytes);
    return parsed.text;
  } catch (error) {
    if (error instanceof NoTextLayerError) {
      // A scan has no text layer to read, so the model reads the pages as
      // images and writes one. Everything downstream — the validator, the
      // review pane, quote matching — then works exactly as it does for a
      // digital PDF, because a transcription is a text layer.
      return transcribePdf(fileBytes);
    }
    throw error;
  }
}

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
  const { body, fileBytes } = await readUpload(c);
  const text = await resolveText(body, fileBytes);

  // The hash is computed here, over the bytes that arrived, and never accepted
  // from the caller. It goes on-chain as the claim that a token corresponds to
  // a specific file, so it has to be this service's own reading of it.
  const hashedBytes = fileBytes ?? toBytes(text);
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
      text,
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

  /*
   * The provenance check runs on its own, not on a button.
   *
   * It answers questions a reviewer would not think to ask — whose agreement
   * is this, and have we seen it before — and a check nobody presses is a
   * check that does not happen. Deliberately not awaited: it costs a model
   * call, and an extraction that succeeded should not appear to fail because
   * a secondary check was slow. The verdict lands on the record and the review
   * screen picks it up.
   */
  void runProvenance(extraction.id).catch((cause) => {
    // Not fatal to the extraction, but not silent either: a check that fails
    // without saying so is indistinguishable from one that passed.
    console.error("provenance failed for", extraction.id, cause);
  });

  return c.json({ extraction }, 201);
});

/**
 * The same pipeline, reported as it happens.
 *
 * Extraction is two model passes over a full agreement and takes about a
 * minute. Behind a single spinner that is indistinguishable from a hang, so
 * this streams the stages and each term as it finishes parsing — the reviewer
 * watches the document resolve rather than waiting on nothing.
 *
 * The work and the result are identical to POST /documents/:id/extract; only
 * the reporting differs.
 */
app.post("/documents/:id/extract/stream", async (c) => {
  const document = await prisma.document.findUnique({
    where: { id: c.req.param("id") },
  });
  if (!document) throw new HTTPException(404, { message: "Unknown document." });

  return streamSSE(c, async (stream) => {
    const send = (event: string, data: unknown) =>
      stream.writeSSE({ event, data: JSON.stringify(data) });

    try {
      const result = await extractTerms(document.text, (event) => {
        void send(event.type, event);
      });

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

      await send("done", { extraction });
    } catch (error) {
      // The stream is already open, so a thrown error would surface as a
      // truncated response rather than a status code. Say what happened.
      await send("failed", {
        message:
          error instanceof ConfigurationError
            ? error.message
            : (error as Error).message,
      });
    }
  });
});

/**
 * The work queue: extractions newest first, each with enough to act on.
 *
 * What a person needs from a list like this is which documents are waiting on
 * them and which are finished, so the status and the terms come along rather
 * than requiring a fetch per row.
 */
app.get("/extractions", async (c) => {
  const status = c.req.query("status");

  const extractions = await prisma.extraction.findMany({
    where: status ? { status: status as never } : undefined,
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      document: { select: { id: true, filename: true, contentHash: true } },
      note: true,
    },
  });

  return c.json({ extractions: jsonSafe(extractions) });
});

app.get("/extractions/:id", async (c) => {
  const extraction = await prisma.extraction.findUnique({
    where: { id: c.req.param("id") },
    include: { document: true, note: true },
  });
  if (!extraction) throw new HTTPException(404, { message: "Unknown extraction." });
  return c.json({ extraction: jsonSafe(extraction) });
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

  /*
   * Confirmations accumulate. `confirmed` says "this field is fine as
   * extracted", which is not recorded on the field itself — unlike a
   * correction, nothing about the value changed, and stamping it as
   * human-edited would claim more than happened. So the record of what has
   * been vouched for lives in `unreviewedFields`, and each request has to
   * carry the earlier ones forward. Passing only this request's set made
   * reviewers confirm fields one at a time and never converge: the second
   * confirmation silently undid the first.
   */
  const alreadyConfirmed = (Object.keys(parsed.data) as TermField[]).filter(
    (field) => !existing.unreviewedFields.includes(field),
  );
  const unreviewed = fieldsNeedingReview(
    parsed.data,
    new Set([...alreadyConfirmed, ...(body.confirmed ?? [])]),
  );

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
/**
 * Gathers what the check needs and runs it.
 *
 * Shared so the automatic run after extraction and the re-run when a borrower
 * is named produce the same verdicts from the same evidence. Identities are
 * read from the registry rather than taken from the caller — the question is
 * whether a party is who they say they are, so accepting their own answer
 * would be circular.
 */
async function runProvenance(extractionId: string, borrowerAddress?: string) {
  const extraction = await prisma.extraction.findUnique({
    where: { id: extractionId },
    include: { document: true },
  });
  if (!extraction) throw new HTTPException(404, { message: "Unknown extraction." });

  const uploader = extraction.document?.uploadedBy;
  if (!uploader) return null;

  const issuerParty = await readParty(uploader as `0x${string}`);
  if (!issuerParty) return null;

  const borrowerParty = borrowerAddress
    ? await readParty(borrowerAddress as `0x${string}`)
    : null;

  const terms = extraction.terms as ExtractedTerms;

  /*
   * A cheap filter before an expensive judgement. Anything sharing a principal
   * or a party with this agreement is worth comparing; the rest is noise that
   * would cost tokens and invite the model to find a resemblance. Capped, so a
   * busy issuer cannot turn one review into an enormous prompt.
   */
  /*
   * Other documents, not other extractions.
   *
   * Re-running extraction on the same upload produces a second row for one
   * agreement, and comparing them would report a document as a duplicate of
   * itself. The identical-bytes case is already covered twice over — the
   * documents table is unique on content hash and `NoteFactory` refuses a hash
   * it has tokenized — so what is left for this check is the only thing those
   * miss: a different file describing the same loan.
   */
  const others = await prisma.extraction.findMany({
    where: {
      id: { not: extractionId },
      documentId: { not: extraction.documentId },
    },
    include: { document: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const key = (value: string) => value.trim().toLowerCase();
  const candidates = others
    .map((other) => {
      const t = other.terms as ExtractedTerms;
      return {
        extractionId: other.id,
        filename: other.document?.filename ?? "document.pdf",
        status: other.status,
        borrower: t.borrower.value,
        lender: t.lender.value,
        principal: t.principal.value,
        agreementDate: t.agreementDate.value,
        maturityDate: t.maturityDate.value,
      };
    })
    .filter(
      (other) =>
        other.principal === terms.principal.value ||
        key(other.borrower) === key(terms.borrower.value) ||
        key(other.lender) === key(terms.lender.value),
    )
    .slice(0, 8);

  const provenance = await checkProvenance({
    terms,
    issuer: {
      address: uploader,
      name: issuerParty.name,
      jurisdiction: issuerParty.jurisdiction,
    },
    borrower: borrowerParty
      ? {
          address: borrowerAddress!,
          name: borrowerParty.name,
          jurisdiction: borrowerParty.jurisdiction,
        }
      : undefined,
    candidates,
  });

  await prisma.extraction.update({
    where: { id: extractionId },
    data: { provenance: asJson(provenance) },
  });

  return provenance;
}

/**
 * The three checks a hash cannot make: is this the issuer's document, is the
 * named borrower the one it names, and has this agreement been tokenized
 * already under a different file?
 *
 * Runs on demand rather than during extraction, because it needs to know who
 * is asking. The registered name comes from the caller — the registry is the
 * authority on membership and the chain enforces that, while this only tells a
 * reviewer whether the paperwork matches the party in front of them.
 */
app.post("/extractions/:id/provenance", async (c) => {
  const body = provenanceRequestSchema.parse(await c.req.json().catch(() => ({})));
  const provenance = await runProvenance(c.req.param("id"), body.borrowerAddress);

  if (!provenance) {
    throw new HTTPException(409, {
      message:
        "This document has no uploader in the registry, so there is nobody to check it against.",
    });
  }

  return c.json({ provenance });
});

/**
 * The assistant.
 *
 * Every figure she returns came from a tool that read the chain or the
 * database; none of those tools can write. `sources` names what ran, so an
 * answer can be checked rather than taken on faith.
 */
app.post("/zoya/messages", async (c) => {
  const body = zoyaSchema.parse(await c.req.json());
  const wallet = body.context?.address?.toLowerCase() ?? null;

  /*
   * History comes from here, not from the request. A browser that supplied its
   * own transcript could put words in her mouth and ask her to reason from
   * them, which would defeat the one property she is built around.
   */
  const history = await loadHistory(body.conversationId);
  const turn = await ask({ ...body, history });

  await prisma.zoyaMessage.createMany({
    data: [
      {
        conversationId: body.conversationId,
        walletAddress: wallet,
        role: "USER",
        content: body.message,
      },
      {
        conversationId: body.conversationId,
        walletAddress: wallet,
        role: "ZOYA",
        content: turn.reply,
        sources: asJson(turn.sources),
      },
    ],
  });

  return c.json(jsonSafe(turn));
});

/** A thread, for the panel to restore after a reload. */
app.get("/zoya/messages", async (c) => {
  const conversationId = c.req.query("conversationId");
  if (!conversationId) {
    throw new HTTPException(400, { message: "conversationId is required." });
  }

  const messages = await prisma.zoyaMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  return c.json({ messages: jsonSafe(messages) });
});

/**
 * The issuer asks the admin to clear a mint.
 *
 * Stores the exact parameters, not a summary. The admin approves a hash of
 * them, and the factory recomputes that hash from whatever is finally
 * submitted — so a request that drifts before it is minted is refused on
 * chain rather than quietly honoured.
 */
app.post("/extractions/:id/mint-request", async (c) => {
  const id = c.req.param("id");
  const body = mintRequestSchema.parse(await c.req.json());

  const extraction = await prisma.extraction.findUnique({ where: { id } });
  if (!extraction) throw new HTTPException(404, { message: "Unknown extraction." });
  if (extraction.status === "MINTED") {
    throw new HTTPException(409, { message: "This note has already been minted." });
  }

  const document = await prisma.document.findUnique({
    where: { id: extraction.documentId },
  });
  if (!document) throw new HTTPException(404, { message: "Unknown document." });

  const currencyAddress = process.env[`${body.currency}_ADDRESS`];
  if (!currencyAddress) {
    throw new ConfigurationError(
      `No address configured for ${body.currency}. Set ${body.currency}_ADDRESS.`,
    );
  }

  /*
   * Built here, not received. The browser sends what the issuer chose — who
   * repays, in what currency, how many tokens — and this derives the actual
   * mint parameters from the reviewed terms. The admin then approves a hash of
   * these, and the same values come back at mint time, so nothing the browser
   * holds can drift between the decision and the transaction.
   */
  const args = buildMintArgs({
    terms: extraction.terms as ExtractedTerms,
    name: `${(extraction.terms as ExtractedTerms).borrower.value} Note`,
    symbol: "NOTE",
    issuer: body.issuer,
    borrower: body.borrower,
    currency: body.currency,
    currencyAddress: currencyAddress as `0x${string}`,
    documentHash: document.contentHash as `0x${string}`,
    supplyTokens: body.supplyTokens,
  });

  const updated = await prisma.extraction.update({
    where: { id },
    data: {
      mintRequest: asJson({
        ...body,
        mintHash: hashMintArgs(args),
        args: jsonSafe(args),
        requestedAt: new Date().toISOString(),
      }),
    },
  });

  /*
   * The borrower is known now, which is a question the first run could not
   * answer — so the verdict is recomputed rather than left half-finished.
   * Not awaited: naming a borrower should not wait on a model call.
   */
  void runProvenance(id, body.borrower).catch((cause) => {
    console.error("provenance failed for", id, cause);
  });

  return c.json({ extraction: jsonSafe(updated) });
});

/**
 * The approved parameters, for the issuer's wallet to sign.
 *
 * Handed back whole rather than rebuilt in the browser. Rebuilding is what
 * would let a form's state diverge from what the admin cleared — and the
 * factory would refuse the result, which is correct but arrives as an
 * unexplained revert.
 */
app.get("/extractions/:id/mint-args", async (c) => {
  const extraction = await prisma.extraction.findUnique({
    where: { id: c.req.param("id") },
  });
  if (!extraction) throw new HTTPException(404, { message: "Unknown extraction." });
  if (!extraction.mintRequest) {
    throw new HTTPException(409, {
      message: "No mint has been requested for this extraction.",
    });
  }

  return c.json({ mintRequest: jsonSafe(extraction.mintRequest) });
});

/** The admin's queue: everything waiting to be cleared for minting. */
app.get("/mint-requests", async (c) => {
  const extractions = await prisma.extraction.findMany({
    where: { mintRequest: { not: Prisma.DbNull }, status: { not: "MINTED" } },
    include: {
      document: { select: { id: true, filename: true, contentHash: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return c.json({ extractions: jsonSafe(extractions) });
});

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

  const gate = mintGate(terms, issuerVerified, {
    confirmed,
    provenance: (extraction.provenance as ProvenanceVerdict | null) ?? undefined,
  });

  return c.json({ gate });
});

const zoyaSchema = z.object({
  message: z.string().min(1).max(4_000),
  /// Groups a thread. The browser generates it and keeps it in local storage.
  conversationId: z.string().min(8).max(64),
  context: z
    .object({
      extractionId: z.string().optional(),
      address: z.string().optional(),
    })
    .optional(),
});

const addressLike = z
  .string()
  .refine((value) => isAddress(value, { strict: false }), "Not an address.")
  .transform((value) => value as `0x${string}`);

const provenanceRequestSchema = z.object({
  /// Named only once the issuer has chosen who repays.
  borrowerAddress: addressLike.optional(),
});

/**
 * What the issuer chooses at issuance. Not the mint parameters themselves —
 * those are derived here from the reviewed terms, so a browser cannot submit
 * one thing for approval and another to the chain.
 */
const mintRequestSchema = z.object({
  issuer: addressLike,
  borrower: addressLike,
  currency: z.enum(CURRENCIES),
  supplyTokens: z.number().positive().max(1_000_000_000),
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

  return c.json({ note: jsonSafe(note) }, 201);
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

  /**
   * Bun closes idle requests after 10 seconds by default, which is far less
   * than an extraction takes: two sequential model passes over a full
   * agreement run to a minute or more, and the connection sits silent
   * throughout. The default was cutting extractions off mid-flight.
   *
   * Seconds; Bun's ceiling is 255.
   */
  idleTimeout: 240,

  fetch: app.fetch,
};
