import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ConfigurationError } from "./errors";

/**
 * Source document storage on Cloudflare R2.
 *
 * R2 speaks the S3 API, so the AWS SDK talks to it unchanged given an endpoint
 * and a region of "auto". Nothing here is R2-specific beyond those two values —
 * pointing `R2_ENDPOINT` at S3 proper, or MinIO, would work as well.
 *
 * Objects are keyed by the hash of their own bytes. That makes uploads
 * idempotent for free, and means the key a document is stored under is the same
 * value `NoteFactory` records on-chain, so an auditor holding only the chain can
 * find the file it refers to.
 */

const BUCKET = process.env.R2_BUCKET;
const ENDPOINT = process.env.R2_ENDPOINT;

/** Whether document storage is configured at all. */
export const storageEnabled = Boolean(
  BUCKET &&
    ENDPOINT &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY,
);

let client: S3Client | undefined;

/**
 * Built on first use, for the same reason the model client is: a service that
 * cannot store PDFs should still serve everything that does not need them,
 * rather than refusing to start.
 */
function s3(): S3Client {
  if (!client) {
    if (!storageEnabled) {
      throw new ConfigurationError(
        "Document storage is not configured. Set R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY in .env.",
      );
    }
    client = new S3Client({
      // R2 has no regions; the SDK still requires the field to be set.
      region: "auto",
      endpoint: ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
  }
  return client;
}

/** Where a document with this content hash lives. */
export function documentKey(contentHash: string, filename: string): string {
  return `documents/${contentHash}${extensionOf(filename)}`;
}

function extensionOf(filename: string): string {
  return filename.includes(".")
    ? filename.slice(filename.lastIndexOf(".")).toLowerCase()
    : "";
}

/**
 * Stores a document, skipping the upload when those exact bytes are already
 * present. Content-addressed keys make that check trivially safe: a key can
 * only ever hold one byte sequence.
 */
export async function putDocument(
  key: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<{ key: string; alreadyStored: boolean }> {
  const s3Client = s3();

  try {
    await s3Client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return { key, alreadyStored: true };
  } catch (error) {
    // Anything other than "not there" is a real failure worth surfacing.
    if (!isNotFound(error)) throw error;
  }

  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: bytes,
      ContentType: contentType,
    }),
  );

  return { key, alreadyStored: false };
}

/**
 * A time-limited URL for reading a document.
 *
 * The bucket stays private: loan agreements are not public documents, and a
 * signed URL means the review screen can display one without the bucket being
 * readable by anyone who guesses a hash.
 */
export function documentUrl(key: string, expiresInSeconds = 300): Promise<string> {
  return getSignedUrl(
    s3(),
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    { expiresIn: expiresInSeconds },
  );
}

export async function getDocument(key: string): Promise<Uint8Array> {
  const result = await s3().send(
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
  );
  if (!result.Body) throw new Error(`No body returned for ${key}.`);
  return result.Body.transformToByteArray();
}

function isNotFound(error: unknown): boolean {
  const name = (error as { name?: string })?.name;
  const status = (error as { $metadata?: { httpStatusCode?: number } })
    ?.$metadata?.httpStatusCode;
  return name === "NotFound" || name === "NoSuchKey" || status === 404;
}
