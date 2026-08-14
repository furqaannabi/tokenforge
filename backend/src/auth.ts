import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { sign, verify } from "hono/jwt";
import { getRandomValues } from "node:crypto";
import { isAddress, verifyMessage } from "viem";
import { z } from "zod";
import { prisma } from "./db";
import { ConfigurationError } from "./errors";

/**
 * Proving a wallet, and remembering that it was proved.
 *
 * A wallet cannot log in with a password, so it signs instead. The shape that
 * makes that safe is: the server issues a random challenge, the wallet signs
 * it, and the server checks the signature recovers to the address that asked.
 * Without the challenge a signature is a bearer token — anyone who ever saw one
 * could present it again — so the nonce is single use and short lived.
 *
 * The cookie carries a JWT naming a session row rather than the claims
 * themselves. A self-contained token cannot be revoked before it expires, and
 * this authorises actions over money; being able to end a session from the
 * server is worth the lookup.
 *
 * httpOnly because the alternative is script-readable. The whole point of a
 * cookie over localStorage here is that a script injected into the page cannot
 * read it out.
 */

const COOKIE = "tokenforge_session";
const NONCE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) {
    throw new ConfigurationError(
      "AUTH_SECRET must be set to at least 32 characters. Generate one with `openssl rand -hex 32`.",
    );
  }
  return value;
}

/** Cookies only travel over https off localhost, and only same-site by default. */
function cookieOptions() {
  const production = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: production,
    sameSite: production ? ("None" as const) : ("Lax" as const),
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}

/**
 * What the wallet is asked to sign.
 *
 * Readable, because a wallet shows it verbatim and a prompt full of hex is one
 * people approve without reading. It names the site and the address so a
 * signature collected by another application cannot be replayed here, and
 * carries the nonce so it cannot be replayed at all.
 */
export function challenge(input: {
  address: string;
  nonce: string;
  domain: string;
}): string {
  return [
    `${input.domain} asks you to sign in.`,
    "",
    "This proves you control this wallet. It is not a transaction, costs no",
    "gas, and authorises no payment.",
    "",
    `Wallet: ${input.address}`,
    `Nonce: ${input.nonce}`,
  ].join("\n");
}

const addressSchema = z
  .string()
  .refine((value) => isAddress(value, { strict: false }), "Not an address.")
  .transform((value) => value.toLowerCase());

const nonceSchema = z.object({ address: addressSchema });
const verifySchema = z.object({
  address: addressSchema,
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});

export const auth = new Hono();

/** Step one: a challenge to sign. */
auth.post("/nonce", async (c) => {
  const { address } = nonceSchema.parse(await c.req.json());

  const bytes = new Uint8Array(32);
  getRandomValues(bytes);
  const nonce = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  await prisma.authNonce.create({
    data: {
      address,
      nonce,
      expiresAt: new Date(Date.now() + NONCE_TTL_MS),
    },
  });

  return c.json({
    nonce,
    message: challenge({ address, nonce, domain: domainOf(c.req.header("origin")) }),
  });
});

/** Step two: the signature, checked against the address that asked. */
auth.post("/verify", async (c) => {
  const { address, signature } = verifySchema.parse(await c.req.json());

  const record = await prisma.authNonce.findFirst({
    where: {
      address,
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!record) {
    throw new HTTPException(401, {
      message: "No challenge is outstanding for that wallet. Ask for a new one.",
    });
  }

  const valid = await verifyMessage({
    address: address as `0x${string}`,
    message: challenge({
      address,
      nonce: record.nonce,
      domain: domainOf(c.req.header("origin")),
    }),
    signature: signature as `0x${string}`,
  });

  /*
   * Consumed either way. A failed attempt burns the challenge so a signature
   * cannot be ground against one that stays valid.
   */
  await prisma.authNonce.update({
    where: { id: record.id },
    data: { consumedAt: new Date() },
  });

  if (!valid) {
    throw new HTTPException(401, {
      message: "That signature does not come from this wallet.",
    });
  }

  const session = await prisma.session.create({
    data: {
      address,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      userAgent: c.req.header("user-agent")?.slice(0, 200) ?? null,
    },
  });

  const token = await sign(
    {
      sid: session.id,
      sub: address,
      exp: Math.floor(session.expiresAt.getTime() / 1000),
    },
    secret(),
  );

  setCookie(c, COOKIE, token, cookieOptions());
  return c.json({ address, expiresAt: session.expiresAt });
});

/** Who the cookie says you are. */
auth.get("/me", async (c) => {
  const session = await currentSession(c);
  if (!session) return c.json({ address: null });
  return c.json({ address: session.address, expiresAt: session.expiresAt });
});

auth.post("/logout", async (c) => {
  const session = await currentSession(c);
  if (session) {
    await prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
  }
  deleteCookie(c, COOKIE, { path: "/" });
  return c.json({ ok: true });
});

function domainOf(origin?: string): string {
  if (!origin) return "TokenForge";
  try {
    return new URL(origin).host;
  } catch {
    return "TokenForge";
  }
}

/** The session behind the cookie, or null. Revoked and expired ones are null. */
export async function currentSession(c: Parameters<typeof getCookie>[0]) {
  const token = getCookie(c, COOKIE);
  if (!token) return null;

  let payload: { sid?: string };
  try {
    payload = (await verify(token, secret(), "HS256")) as { sid?: string };
  } catch {
    return null;
  }
  if (!payload.sid) return null;

  const session = await prisma.session.findUnique({ where: { id: payload.sid } });
  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    return null;
  }

  // Cheap liveness for the audit trail; not awaited on the request path.
  void prisma.session
    .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
    .catch(() => {});

  return session;
}

/**
 * Refuses anything without a valid session, and hands the address downstream.
 *
 * Routes read `c.get("address")` rather than trusting a field in the body. An
 * address the caller supplies is a claim; this one has been proved.
 */
export const requireAuth = createMiddleware<{
  Variables: { address: string };
}>(async (c, next) => {
  const session = await currentSession(c);
  if (!session) {
    throw new HTTPException(401, {
      message: "Sign in with your wallet to do that.",
    });
  }

  c.set("address", session.address);
  await next();
});
