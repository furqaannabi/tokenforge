# TokenForge extraction service

A legal document in, validated economic terms out. Hono on Bun, Prisma over
Postgres, Gemini for structured extraction through its OpenAI-compatible
endpoint, and Cloudflare R2 for the documents themselves.

## Running it

```bash
cp .env.example .env        # add GEMINI_API_KEY
bun install
bun run db:up               # Postgres in Docker
bun run db:migrate
bun run dev                 # http://localhost:8787
```

Only extraction needs `GEMINI_API_KEY`, and only file storage needs the `R2_*`
values. Without either, the rest of the service still runs — a missing key
fails that one endpoint with a 503 explaining which value is absent, rather
than refusing to start.

## The pipeline

```text
document text
    ↓  extract      two model passes: read, then audit its own output
terms + confidence
    ↓  validate     deterministic rules; ignores confidence entirely
issues
    ↓  route        below-threshold fields go to a human
status
```

The three stages answer different questions and fail independently:

- **Extraction** produces values, per-field confidence, and the verbatim clause
  each value came from. It streams: the partial parse means a term can be
  reported the moment it completes rather than a minute later in one lump. A second pass audits the first against the source, since
  a model asked for a number and a certainty in one breath tends to justify the
  number it just wrote.
- **The validator** is rules, not AI. It checks that dates are ordered, the
  schedule reproduces the stated rate against a declining balance, principal
  reconciles, and the cadence matches the declared frequency. It ignores
  confidence: a term set the model was 99% sure of still fails if the arithmetic
  does not hold.
- **Confidence routing** sends uncertain fields to a person. Distinct from
  validation — terms can be arithmetically perfect and still too uncertain to
  mint unsupervised.

`INVALID` means the numbers contradict each other and no amount of human
confirmation helps. `NEEDS_REVIEW` means they hang together but someone must
vouch for a field.

## Storage

Documents go to Cloudflare R2, which speaks the S3 API — nothing in
`src/storage.ts` is R2-specific beyond the endpoint and `region: "auto"`, so
`R2_ENDPOINT` points the same code at S3 or MinIO.

The client posts the file to this service and the service does the put, so the
bucket needs no CORS rule and the credentials stay server-side. Objects are
keyed by the hash of their own bytes, which makes re-uploads idempotent and
means the key a document sits under is the value written on-chain: someone
holding only the chain can find the file it refers to.

The hash is always computed here, over the bytes that arrived, and never
accepted from the caller — it is the claim that a token corresponds to a
specific document.

Buckets stay private. Reading goes through a short-lived signed URL.

## Endpoints

| | |
|---|---|
| `POST /documents` | Register a document. Send it as multipart with a `file` part and the service stores it in R2; deduplicated by keccak256 of its bytes, the same hash `NoteFactory` claims on-chain |
| `GET /documents/:id/url` | Short-lived signed URL for the stored file |
| `POST /documents/:id/extract` | Run the pipeline |
| `POST /documents/:id/extract/stream` | The same, reported as server-sent events: each stage, and each term as it finishes parsing |
| `GET /extractions/:id` | Extraction with its document and note |
| `POST /extractions/:id/review` | Record corrections and confirmations, then re-validate |
| `GET /extractions/:id/mint-gate` | Whether these terms may be minted, and why not |
| `POST /extractions/:id/mint` | Record a mint that already happened on-chain |

This service never holds a key or sends a transaction. The issuer's own wallet
signs; `/mint` indexes what the chain already accepted.

## Known gaps

**No PDF parsing yet.** `POST /documents` takes the file *and* an
already-extracted text layer, because the OCR/text step in front of it does not
exist. Upload without a file and the content hash falls back to hashing the
text, which is internally consistent but cannot be verified against the original
PDF — so on-chain provenance is only meaningful for uploads that include one.

**Large files pass through the service.** Multipart keeps the bytes off a base64
round trip, but they still land in this process's memory. Fine at agreement
sizes; anything much larger wants presigned direct-to-bucket uploads, which
would need a CORS rule on the bucket in exchange.

**Extraction quality is barely measured.** The pipeline runs against Gemini for
real and behaves correctly on both sample documents, but two hand-written
samples are not evidence about genuine agreements — which remains the project's
central risk. Confidence varies run to run and does produce mid-range values;
whether it is *well* calibrated is unknown.
