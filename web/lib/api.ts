import type { Currency } from "@tokenforge/core";
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

export const BASE_URL =
  process.env.NEXT_PUBLIC_EXTRACTION_API_URL ?? "http://localhost:8787";

export type ApplicationStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "WITHDRAWN";

export interface ApiIssuerApplication {
  id: string;
  walletAddress: `0x${string}`;
  companyName: string;
  jurisdiction: string;
  registrationNumber: string | null;
  contactEmail: string;
  website: string | null;
  description: string | null;
  status: ApplicationStatus;
  decisionNote: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  admitTxHash: `0x${string}` | null;
  createdAt: string;
}

/** Progress reported while an extraction runs. */
export type ExtractionStreamEvent =
  | {
      type: "stage";
      stage: "extracting" | "auditing" | "validating";
      message: string;
    }
  | { type: "field"; field: string; value: unknown; confidence: number }
  | { type: "usage"; promptTokens: number; completionTokens: number };

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
  provenance?: ApiProvenance | null;
  mintRequest?: ApiMintRequest | null;
}

/**
 * A list row. Identical to a full extraction except that the document arrives
 * without its `text` — the list endpoint omits it deliberately, since a page of
 * rows would otherwise carry a hundred loan agreements' worth of prose.
 */
export interface ApiExtractionSummary extends Omit<ApiExtraction, "document"> {
  document?: Pick<ApiDocument, "id" | "filename" | "contentHash">;
}

/** The two checks a hash cannot make. Null until they have been run. */
export interface ApiProvenance {
  ownership: {
    belongsToIssuer: boolean;
    confidence: number;
    documentLender: string;
    reason: string;
  };
  duplicate: {
    isDuplicate: boolean;
    ofExtractionId: string | null;
    confidence: number;
    reason: string;
  };
}

/**
 * What the issuer asked to mint, and the hash the admin approves.
 *
 * `args` are the parameters the service derived from the reviewed terms. They
 * come back whole at mint time rather than being rebuilt in the browser —
 * rebuilding is exactly what could drift from what the admin cleared. BigInts
 * arrive as strings, as everything numeric does over JSON.
 */
export interface ApiMintRequest {
  issuer: `0x${string}`;
  borrower: `0x${string}`;
  currency: Currency;
  supplyTokens: number;
  mintHash: `0x${string}`;
  requestedAt: string;
  args: {
    name: string;
    symbol: string;
    issuer: `0x${string}`;
    borrower: `0x${string}`;
    supply: string;
    currency: `0x${string}`;
    gracePeriod: string;
    terms: {
      principal: string;
      rateBps: number;
      maturity: string;
      documentHash: `0x${string}`;
      scheduleHash: `0x${string}`;
    };
    schedule: { dueDate: string; principal: string; interest: string }[];
  };
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
    // FormData must set its own Content-Type so the multipart boundary is
    // included; forcing application/json here would corrupt the upload.
    const isFormData = init?.body instanceof FormData;

    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        ...(isFormData ? {} : { "Content-Type": "application/json" }),
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

  // --- Issuer onboarding ---------------------------------------------------
  // Applications are off-chain paperwork. Admission itself is a transaction the
  // admin's wallet signs against IssuerRegistry, never a call to this service.

  apply: (input: {
    walletAddress: string;
    companyName: string;
    jurisdiction: string;
    registrationNumber?: string | null;
    contactEmail: string;
    website?: string | null;
    description?: string | null;
  }) =>
    request<{ application: ApiIssuerApplication }>("/issuers/applications", {
      method: "POST",
      body: JSON.stringify(input),
    }).then((r) => r.application),

  requestMint: (
    extractionId: string,
    body: {
      issuer: `0x${string}`;
      borrower: `0x${string}`;
      currency: Currency;
      supplyTokens: number;
    },
  ) =>
    request<{ extraction: ApiExtraction }>(
      `/extractions/${extractionId}/mint-request`,
      { method: "POST", body: JSON.stringify(body) },
    ).then((r) => r.extraction),

  mintArgs: (extractionId: string) =>
    request<{ mintRequest: ApiMintRequest }>(
      `/extractions/${extractionId}/mint-args`,
    ).then((r) => r.mintRequest),

  listMintRequests: () =>
    request<{ extractions: ApiExtractionSummary[] }>("/mint-requests").then(
      (r) => r.extractions,
    ),

  checkProvenance: (
    extractionId: string,
    body: { issuerName: string; issuerJurisdiction?: string },
  ) =>
    request<{ provenance: ApiProvenance }>(
      `/extractions/${extractionId}/provenance`,
      { method: "POST", body: JSON.stringify(body) },
    ).then((r) => r.provenance),

  listApplications: (status?: ApplicationStatus) =>
    request<{ applications: ApiIssuerApplication[] }>(
      `/issuers/applications${status ? `?status=${status}` : ""}`,
    ).then((r) => r.applications),

  /** Where a given wallet stands. 404 when it has never applied. */
  applicationForWallet: (address: string) =>
    request<{ application: ApiIssuerApplication }>(
      `/issuers/applications/by-wallet/${address}`,
    ).then((r) => r.application),

  /** Records an admission the chain has already confirmed. */
  recordAdmission: (
    id: string,
    input: { txHash: string; decidedBy?: string | null; decisionNote?: string | null },
  ) =>
    request<{ application: ApiIssuerApplication }>(
      `/issuers/applications/${id}/admitted`,
      { method: "POST", body: JSON.stringify(input) },
    ).then((r) => r.application),

  rejectApplication: (
    id: string,
    input: { decidedBy?: string | null; decisionNote?: string | null },
  ) =>
    request<{ application: ApiIssuerApplication }>(
      `/issuers/applications/${id}/reject`,
      { method: "POST", body: JSON.stringify(input) },
    ).then((r) => r.application),

  listDocuments: () =>
    request<{ documents: ApiDocument[] }>("/documents").then((r) => r.documents),

  /**
   * Registers an uploaded document. Pass the `storageKey` from
   * `requestUploadUrl`; the service reads those bytes back to compute the
   * content hash, so it never takes the caller's word for what was uploaded.
   */
  /**
   * Registers a document, sending the file with it.
   *
   * Multipart rather than JSON: the file travels as bytes instead of base64,
   * which is a third smaller and avoids holding an encoded copy in memory. The
   * service hashes what it receives, so provenance never rests on the client's
   * word about which document this is.
   */
  uploadDocument: (input: {
    file?: File | null;
    filename: string;
    /** Omit for a PDF: the service reads the text layer out of it. */
    text?: string;
    uploadedBy?: string | null;
  }) => {
    if (!input.file) {
      return request<{ document: ApiDocument; alreadyKnown: boolean }>(
        "/documents",
        {
          method: "POST",
          body: JSON.stringify({
            filename: input.filename,
            text: input.text ?? "",
            uploadedBy: input.uploadedBy ?? null,
          }),
        },
      );
    }

    const form = new FormData();
    form.set("file", input.file);
    form.set("filename", input.filename);
    if (input.text) form.set("text", input.text);
    if (input.uploadedBy) form.set("uploadedBy", input.uploadedBy);

    return request<{ document: ApiDocument; alreadyKnown: boolean }>(
      "/documents",
      { method: "POST", body: form },
    );
  },

  documentUrl: (documentId: string) =>
    request<{ url: string }>(`/documents/${documentId}/url`).then((r) => r.url),

  /**
   * Runs extraction, reporting progress as it goes.
   *
   * Server-sent events over `fetch` rather than `EventSource`, which cannot
   * issue a POST. Extraction is a minute of work, so the alternative is a
   * spinner that looks identical to a hang.
   */
  extractStreaming: async (
    documentId: string,
    onEvent: (event: ExtractionStreamEvent) => void,
  ): Promise<ApiExtraction> => {
    const response = await fetch(
      `${BASE_URL}/documents/${documentId}/extract/stream`,
      { method: "POST" },
    ).catch(() => {
      throw new ApiError(0, `Cannot reach the extraction service at ${BASE_URL}.`);
    });

    if (!response.ok || !response.body) {
      const body = await response.json().catch(() => null);
      throw new ApiError(response.status, body?.error ?? "Extraction failed.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let extraction: ApiExtraction | undefined;
    let failure: string | undefined;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line; a partial frame stays in the
      // buffer until the rest of it arrives.
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        const name = frame.match(/^event:\s*(.+)$/m)?.[1]?.trim();
        const raw = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("");
        if (!name || !raw) continue;

        const payload = JSON.parse(raw);
        if (name === "done") extraction = payload.extraction;
        else if (name === "failed") failure = payload.message;
        else onEvent(payload as ExtractionStreamEvent);
      }
    }

    if (failure) throw new ApiError(500, failure);
    if (!extraction) throw new ApiError(500, "The stream ended without a result.");
    return extraction;
  },

  extract: (documentId: string) =>
    request<{ extraction: ApiExtraction }>(`/documents/${documentId}/extract`, {
      method: "POST",
    }).then((r) => r.extraction),

  /** The work queue, newest first. */
  listExtractions: (status?: ExtractionStatus) =>
    request<{ extractions: ApiExtractionSummary[] }>(
      `/extractions${status ? `?status=${status}` : ""}`,
    ).then((r) => r.extractions),

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

