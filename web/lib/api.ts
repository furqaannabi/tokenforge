import type {
  ExtractedTerms,
  MintGate,
  TermField,
  ValidationIssue,
} from "@tokenforge/core";

/**
 * Client for the extraction service in ../backend.
 *
 * The service owns documents, extractions, and the review record. This app owns
 * the wallet and the on-chain calls. The split matters: the service never holds
 * a key and never sends a transaction, so anything touching the chain stays
 * here and the service is told about it afterwards.
 */

const BASE_URL =
  process.env.NEXT_PUBLIC_EXTRACTION_API_URL ?? "http://localhost:8787";

export type ExtractionStatus =
  | "PENDING"
  | "NEEDS_REVIEW"
  | "INVALID"
  | "VALIDATED"
  | "MINTED"
  | "REJECTED";

export interface ApiDocument {
  id: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  contentHash: `0x${string}`;
  text: string;
  storageKey: string | null;
  uploadedBy: string | null;
  createdAt: string;
}

export interface ApiExtraction {
  id: string;
  documentId: string;
  model: string;
  status: ExtractionStatus;
  terms: ExtractedTerms;
  issues: ValidationIssue[];
  consistent: boolean;
  unreviewedFields: TermField[];
  promptTokens: number | null;
  completionTokens: number | null;
  latencyMs: number | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  document?: ApiDocument;
  note?: ApiNote | null;
}

export interface ApiNote {
  id: string;
  extractionId: string;
  chainId: number;
  noteAddress: `0x${string}`;
  vaultAddress: `0x${string}`;
  issuerAddress: `0x${string}`;
  txHash: `0x${string}`;
  blockNumber: string;
  name: string;
  symbol: string;
  mintedAt: string;
}

/**
 * An error the service reported, with its message preserved.
 *
 * The service distinguishes a bad request from its own misconfiguration — a
 * missing model key comes back as 503 with the name of the absent value — and
 * that distinction is worth surfacing rather than flattening into "failed".
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** The service is running but not configured to do this. */
  get isConfiguration(): boolean {
    return this.status === 503;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
  } catch {
    // A refused connection is the common case in development, and "fetch
    // failed" does not tell anyone which process is missing.
    throw new ApiError(
      0,
      `Cannot reach the extraction service at ${BASE_URL}. Is it running?`,
    );
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      body?.error ?? `${response.status} ${response.statusText}`,
    );
  }

  return response.json() as Promise<T>;
}

// ---------------------------------------------------------------------------

export const api = {
  health: () => request<{ ok: boolean; service: string }>("/health"),

  listDocuments: () =>
    request<{ documents: ApiDocument[] }>("/documents").then((r) => r.documents),

  /**
   * Registers a document. `fileBase64` is what makes the content hash the
   * file's own — without it the hash falls back to the text layer and cannot
   * be verified against the original PDF.
   */
  uploadDocument: (input: {
    filename: string;
    text: string;
    fileBase64?: string | null;
    mimeType?: string;
    uploadedBy?: string | null;
  }) =>
    request<{ document: ApiDocument; alreadyKnown: boolean }>("/documents", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  documentUrl: (documentId: string) =>
    request<{ url: string }>(`/documents/${documentId}/url`).then((r) => r.url),

  extract: (documentId: string) =>
    request<{ extraction: ApiExtraction }>(`/documents/${documentId}/extract`, {
      method: "POST",
    }).then((r) => r.extraction),

  getExtraction: (extractionId: string) =>
    request<{ extraction: ApiExtraction }>(`/extractions/${extractionId}`).then(
      (r) => r.extraction,
    ),

  /** Records corrections and confirmations, then re-validates server-side. */
  review: (
    extractionId: string,
    input: {
      terms?: Record<string, unknown>;
      confirmed?: string[];
      reviewedBy?: string | null;
    },
  ) =>
    request<{ extraction: ApiExtraction }>(`/extractions/${extractionId}/review`, {
      method: "POST",
      body: JSON.stringify(input),
    }).then((r) => r.extraction),

  mintGate: (extractionId: string, issuerVerified: boolean) =>
    request<{ gate: MintGate }>(
      `/extractions/${extractionId}/mint-gate?issuerVerified=${issuerVerified}`,
    ).then((r) => r.gate),

  /** Tells the service about a mint the wallet already made. */
  recordMint: (
    extractionId: string,
    input: {
      chainId: number;
      noteAddress: string;
      vaultAddress: string;
      issuerAddress: string;
      txHash: string;
      blockNumber: string | number;
      name: string;
      symbol: string;
    },
  ) =>
    request<{ note: ApiNote }>(`/extractions/${extractionId}/mint`, {
      method: "POST",
      body: JSON.stringify(input),
    }).then((r) => r.note),
};

/** Browser File to the base64 the upload endpoint expects. */
export async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // Chunked rather than spread: a large PDF blows the argument limit of
  // String.fromCharCode in one call.
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
