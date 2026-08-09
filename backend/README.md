# TokenForge extraction service

A legal document in, validated economic terms out. Hono on Bun, Prisma over
Postgres, OpenAI for structured extraction.

## Running it

```bash
cp .env.example .env        # add OPENAI_API_KEY
bun install
bun run db:up               # Postgres in Docker
bun run db:migrate
bun run dev                 # http://localhost:8787
```

Only extraction needs `OPENAI_API_KEY`. Uploading documents and reviewing
extractions work without one.

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
  each value came from. A second pass audits the first against the source, since
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

## Endpoints

| | |
|---|---|
| `POST /documents` | Register a document. Deduplicated by keccak256 of its bytes — the same hash `NoteFactory` claims on-chain |
| `POST /documents/:id/extract` | Run the pipeline |
| `GET /extractions/:id` | Extraction with its document and note |
| `POST /extractions/:id/review` | Record corrections and confirmations, then re-validate |
| `GET /extractions/:id/mint-gate` | Whether these terms may be minted, and why not |
| `POST /extractions/:id/mint` | Record a mint that already happened on-chain |

This service never holds a key or sends a transaction. The issuer's own wallet
signs; `/mint` indexes what the chain already accepted.

## Known gaps

**The validator is duplicated.** `web/lib/validator.ts` carries a copy of
`src/validator.ts`. They must not drift — the intended fix is for the web app to
import from here once the two packages share a workspace.

**No PDF parsing yet.** `POST /documents` takes an already-extracted text layer.
The OCR/text step in front of it does not exist.

**Extraction is unverified against real documents.** The prompt and two-pass
design are untested on anything but hand-written samples, and extraction quality
on genuine agreements is the project's central risk.
