import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { isAddress } from "viem";
import { z } from "zod";
import { prisma } from "./db";

/**
 * Issuer onboarding.
 *
 * Applications live here because they are corporate paperwork: contact
 * details, registration numbers, and the record of companies that were turned
 * down. `IssuerRegistry` stores only an address, a name and a jurisdiction,
 * which is all the contract needs to decide who may mint.
 *
 * Nothing in this file sends a transaction or holds a key. Admission is signed
 * by the registry admin's own wallet against the contract directly; these
 * routes record the decision and the transaction that carried it out. That
 * split is deliberate — a service that could admit issuers by itself would be
 * a second, softer registry, and the on-chain one would stop being the answer.
 */

export const issuers = new Hono();

const addressSchema = z
  .string()
  // `strict: false` checks the shape without demanding a valid EIP-55
  // checksum. Strict validation would reject a correctly-typed address whose
  // casing happens to be wrong, reporting it as "not a valid address" — and
  // the checksum buys nothing here, because the value is lowercased anyway.
  .refine((value) => isAddress(value, { strict: false }), "Not a valid address.")
  // Lowercased so a casing difference cannot produce two applications for one
  // wallet.
  .transform((value) => value.toLowerCase());

const applicationSchema = z.object({
  walletAddress: addressSchema,
  companyName: z.string().min(1).max(200),
  jurisdiction: z.string().min(1).max(120),
  registrationNumber: z.string().max(120).nullable().default(null),
  contactEmail: z.string().email(),
  website: z.string().url().nullable().default(null),
  description: z.string().max(2000).nullable().default(null),
});

/**
 * Applies to become an issuer.
 *
 * Re-applying replaces a pending or rejected application rather than creating a
 * second one — a company correcting its own details is not a new applicant. An
 * already-approved wallet is left alone, since revoking it is a decision for
 * the registry, not a side effect of a form submission.
 */
issuers.post("/applications", async (c) => {
  const body = applicationSchema.parse(await c.req.json());

  const existing = await prisma.issuerApplication.findUnique({
    where: { walletAddress: body.walletAddress },
  });

  if (existing?.status === "APPROVED") {
    throw new HTTPException(409, {
      message: "This wallet is already an admitted issuer.",
    });
  }

  const application = existing
    ? await prisma.issuerApplication.update({
        where: { id: existing.id },
        data: { ...body, status: "PENDING", decisionNote: null, decidedAt: null },
      })
    : await prisma.issuerApplication.create({ data: body });

  return c.json({ application }, existing ? 200 : 201);
});

/** The queue an admin works through, newest first. */
issuers.get("/applications", async (c) => {
  const status = c.req.query("status");

  const applications = await prisma.issuerApplication.findMany({
    where: status ? { status: status as never } : undefined,
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return c.json({ applications });
});

/** One application, by wallet — how the UI tells an applicant where they stand. */
issuers.get("/applications/by-wallet/:address", async (c) => {
  const address = c.req.param("address").toLowerCase();

  const application = await prisma.issuerApplication.findUnique({
    where: { walletAddress: address },
  });
  if (!application) {
    throw new HTTPException(404, {
      message: "No application from this wallet.",
    });
  }

  return c.json({ application });
});

const decisionSchema = z.object({
  /// The admin address that made the call, for the audit trail.
  decidedBy: addressSchema.nullable().default(null),
  decisionNote: z.string().max(1000).nullable().default(null),
});

const admissionSchema = decisionSchema.extend({
  /// The transaction that admitted them. Proof the decision reached the chain.
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "Not a transaction hash."),
});

/**
 * Records an admission that already happened on-chain.
 *
 * Called after `IssuerRegistry.admitIssuer` confirms. The registry is the
 * source of truth for who may mint; this only marks the queue so an admin is
 * not shown the same application twice.
 */
issuers.post("/applications/:id/admitted", async (c) => {
  const body = admissionSchema.parse(await c.req.json());

  const application = await prisma.issuerApplication
    .update({
      where: { id: c.req.param("id") },
      data: {
        status: "APPROVED",
        admitTxHash: body.txHash,
        decidedBy: body.decidedBy,
        decisionNote: body.decisionNote,
        decidedAt: new Date(),
      },
    })
    .catch(() => null);

  if (!application) {
    throw new HTTPException(404, { message: "Unknown application." });
  }

  return c.json({ application });
});

/**
 * Turns an application down.
 *
 * Purely off-chain: there is nothing to write, because a wallet that was never
 * admitted is already unable to mint. Recording it stops the queue re-offering
 * a decision that has been made.
 */
issuers.post("/applications/:id/reject", async (c) => {
  const body = decisionSchema.parse(await c.req.json());

  const application = await prisma.issuerApplication
    .update({
      where: { id: c.req.param("id") },
      data: {
        status: "REJECTED",
        decidedBy: body.decidedBy,
        decisionNote: body.decisionNote,
        decidedAt: new Date(),
      },
    })
    .catch(() => null);

  if (!application) {
    throw new HTTPException(404, { message: "Unknown application." });
  }

  return c.json({ application });
});
