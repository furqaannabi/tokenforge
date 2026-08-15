# TokenForge extraction service

A legal document in, validated economic terms out. Hono on Bun, Prisma over
Postgres, Gemini for reading documents, and Cloudflare R2 for the documents
themselves.

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
PDF
    ↓  parse        text layer via pdf.js, or Gemini transcribes a scan
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
- **Provenance** asks two questions the document hash cannot. `NoteFactory`
  refuses a hash it has tokenized and the documents table is unique on the same
  value, but both are exact-byte checks: the same agreement re-exported or
  rescanned is a different file describing the same loan. Nothing checked whose
  agreement it was either. Both verdicts are scored and explained, and block the
  mint rather than refusing silently — a reviewer who knows the group structure
  can overrule them.
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

Reading has two modes. Set `R2_PUBLIC_URL` to a custom domain in front of the
bucket and links are permanent and unsigned, which is convenient for a demo but
means anyone holding one can read the agreement — and the keys are content
hashes, not secrets. Leave it unset and the bucket stays private behind
five-minute signed URLs, which is the right default for documents nobody
intended to publish.

## Endpoints

| | |
|---|---|
| `POST /documents` | Register a document. Send it as multipart with a `file` part and the service stores it in R2; deduplicated by keccak256 of its bytes, the same hash `NoteFactory` claims on-chain |
| `GET /documents` | Recent documents |
| `GET /documents/:id/url` | A URL for the stored file — permanent or signed, see Storage |
| `POST /documents/:id/extract` | Run the pipeline |
| `POST /documents/:id/extract/stream` | The same, reported as server-sent events: each stage, and each term as it finishes parsing |
| `GET /extractions` | Recent extractions with their status, filterable by `?status=`. The document arrives without its text, which a page of rows does not need |
| `GET /extractions/:id` | Extraction with its document and note |
| `POST /extractions/:id/review` | Record corrections and confirmations, then re-validate |
| `POST /extractions/:id/provenance` | Two checks a hash cannot make: is the document's lender this issuer, and has the same agreement been extracted under another file |
| `POST /extractions/:id/mint-request` | The issuer submits what they intend to mint. The service derives the parameters from the reviewed terms and hashes them |
| `GET /extractions/:id/mint-args` | The approved parameters, for the issuer's wallet to sign |
| `GET /mint-requests` | The admin's queue of mints awaiting a decision |
| `POST /zoya/messages` | The assistant. Returns her reply and the tools it rested on |
| `POST /zoya/stream` | The same turn as server-sent events: `delta` per fragment, `tool` when one starts, `done` with the sources |
| `GET /keeper` | Whether automatic collection is running and what it last did. Public |
| `POST /keeper/sweep` | Run a collection sweep now. Signed in — it spends the keeper's gas |
| `GET /extractions/:id/mint-gate` | Whether these terms may be minted, and why not |
| `POST /extractions/:id/mint` | Record a mint that already happened on-chain |
| `POST /issuers/applications` | Apply to the registry — corporate detail that has no business on-chain |
| `GET /issuers/applications` | The queue, filterable by `?status=` |
| `GET /issuers/applications/by-wallet/:address` | Whether a wallet has applied |
| `POST /issuers/applications/:id/admitted` | Record an admission the admin already signed |
| `POST /issuers/applications/:id/reject` | Decline an application |

This service never holds a key or sends a transaction. The issuer's own wallet
signs; `/mint` indexes what the chain already accepted.

It does, however, build the mint parameters. The browser sends only what an
issuer actually chooses — who repays, in what currency, how many tokens — and
the rest is derived here from the reviewed terms, hashed for the admin to
approve, and handed back unchanged at mint time. Rebuilding them in the browser
is what would let a stale form diverge from what the admin cleared, and the
factory would refuse the result: correct, but arriving as an unexplained
revert. The same applies to
admission — the admin signs `admitIssuer` from their own wallet and the service
is told afterwards, because a service that could admit issuers would become a
second registry and the on-chain one would stop being the answer.

A confirmation carries forward. `POST /review` accepts a `confirmed` list, and
the fields already cleared are merged with it rather than replaced — passing
only the current request's set meant confirming a second field silently
un-confirmed the first, and a reviewer working one field at a time never
converged.

## Zoya

`zoya.ts` is a bounded tool loop over reads that already exist: the minted
notes, a note's live chain state, its vault schedule, what is on offer, a
wallet's position, and the extracted terms with their confidence. `chain.ts`
does the reading and `abi.ts` carries view functions only, so there is nothing
here that could write even if something asked it to.

Her system prompt's first rule is that she may not state a number she did not
read from a tool. The second is that she says which source a figure came from,
because "the vault's schedule says" and "the extraction found" are different
claims — the first is what the contract will pay, the second is what a model
read off a PDF and may still be under review.

One trap worth knowing: thinking models attach a `thoughtSignature` to each
function call, and rebuilding the model's turn from `functionCalls` drops it.
The API then rejects the history with a 400 that names neither cause nor fix.
Echo the candidate's own `content` back instead.

Document text reaches her only as data. An uploaded agreement is untrusted
input — anyone admitted can upload one — and a PDF carrying instructions is a
realistic attack on a lending product, not a theoretical one. Figures come from
the chain and the validator, which no document can reach.

## The keeper

`startKeeper` sweeps every `KEEPER_INTERVAL_MS` (default one minute): it reads
`collectible()` on every minted note's vault in one multicall, and calls
`collectFromBorrower` on the ones that answer true. Serially, each receipt
awaited before the next send — concurrent sends from one account race on the
nonce, and the loser is dropped silently, which would look like a payment that
succeeded and never landed.

The key only pays gas. `collectFromBorrower` takes no arguments and names no
recipient, so this service cannot move money to an address of its choosing. It
is the one write ABI the backend carries, and nothing else should be added.

Its sweep log is held in memory, so `GET /keeper` forgets what it collected
across a restart. The collections themselves are on-chain and permanent — the
vault's `PeriodSettled` events are the real record — but the status endpoint
cannot currently tell "collected and forgotten" from "never ran".

Without `KEEPER_PRIVATE_KEY` the keeper logs that it is off and does nothing;
collection remains available to anyone from the note page. `GET /keeper` is
public and reports the last sweep; `POST /keeper/sweep` runs one now and needs a
session, because that one spends the keeper's gas.

## Known gaps

**Scans go through the model twice.** A photographed agreement has no text
layer, so Gemini reads the pages as images and transcribes them, and only then
does extraction run. That is two calls where a digital PDF needs one, and the
transcription is trusted without a second reader checking it.

**Large files pass through the service.** Multipart keeps the bytes off a base64
round trip, but they still land in this process's memory. Fine at agreement
sizes; anything much larger wants presigned direct-to-bucket uploads, which
would need a CORS rule on the bucket in exchange.

**Extraction quality is barely measured.** The pipeline runs against Gemini for
real and behaves correctly on both sample documents, but two hand-written
samples are not evidence about genuine agreements — which remains the project's
central risk. Confidence varies run to run and does produce mid-range values;
whether it is *well* calibrated is unknown.
