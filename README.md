<img src="web/public/logo.png" alt="" width="80" />

# TokenForge

**Only verified issuers can turn real financial agreements into programmable onchain assets.**

Upload a loan agreement, invoice, or bond term sheet; an AI extracts the economic terms with per-field confidence scores; after human review and issuer approval, a cash-flow-programmed RWA token is minted on X Layer and its coupons pay holders in USDG.

Built for the OKX "Build X" AI Season Hackathon (X Layer, Aug 7–21, 2026), AI-RWA track.

## The problem

Tokenizing a real-world debt instrument today means a human reads a non-standardized legal PDF and manually transcribes principal, rate, day-count, maturity, schedule, and covenants into a contract deployment. That transcription step is the bottleneck, and it doesn't scale.

TokenForge puts an LLM on that critical path. Remove the model and there is no product — only manual paralegal data entry.

## How it works

```text
Company is verified and admitted to the issuer registry
        ↓
Verified issuer uploads loan document      → stored in R2, hashed
        ↓
AI extracts terms with per-field confidence
        ↓
Deterministic validator checks internal consistency
        ↓
Human reviews low-confidence fields
        ↓
Authorized issuer representative approves
        ↓
RWANote minted on X Layer, document hash stored on-chain
        ↓
Investors hold proportional shares
        ↓
Borrower deposits USDG repayments
        ↓
Holders claim principal + interest pro-rata
```

## The trust stack

No single check is trusted on its own. Five layers each do a different job:

| Layer | What it establishes |
|---|---|
| Company verification | Corporate identity and an authorized representative; only registered issuers can mint |
| AI verification | Extracts terms, cross-checks the document, flags inconsistencies, scores confidence |
| Human verification | A person reads the source document and confirms or corrects the AI's output |
| Issuer approval | The authorized representative signs off on the final terms on-chain |
| Onchain enforcement | Terms are immutable, the document hash is recorded, the repayment schedule is enforced by contract |

**Issuer verification is an eligibility layer, not a safety guarantee.** A reputable company can still originate a bad loan. Verification controls *who may issue*; it says nothing about whether a particular loan will be repaid. Credit risk remains entirely with the investor.

## Handling uncertainty

An LLM cannot extract facts a document was written to obscure. TokenForge is built around that limit rather than pretending it away.

The three checks fail independently, and the difference matters:

- **Confidence scoring** comes from a second model pass that audits the first against the source. It answers *how sure was the model*.
- **The deterministic validator** is rules, not AI. It checks that dates are ordered, principal reconciles, the cadence matches the declared frequency, and the schedule reproduces the stated rate against a declining balance. It ignores confidence entirely — terms a model was certain about still fail when the arithmetic doesn't hold.
- **Human review** clears low-confidence fields. Terms can be arithmetically perfect and still too uncertain to mint unsupervised.

So `INVALID` and `NEEDS_REVIEW` mean genuinely different things: the first cannot be cleared by any amount of human confirmation, the second is waiting for someone to vouch for a field.

This is not theoretical. Running the deliberately contradictory sample document through the real pipeline:

```
interestRatePct  0.50  6
  note: Clause 2 states 6% but the payment table implies 9.4%
        ($35,250 semi-annually on $750,000).

validator blocking: Scheduled interest totals 211,500, but 6% on a
30/360 basis implies 135,000.                    → status INVALID
```

The model extracted the *stated* rate rather than quietly reconciling it, and the validator caught the contradiction independently.

## Layout

```text
packages/core   Extraction schema and deterministic validator — one copy,
                imported by both the web app and the service
backend         Hono on Bun · Prisma over Postgres · Gemini · R2
web             Next.js · wagmi/viem · Reown AppKit
contracts       Foundry · deployed and verified on X Layer testnet
```

`packages/core` exists because the validator decides whether terms may reach a contract. Two copies would eventually disagree — a reviewer's browser approving what the server would refuse, or worse the reverse.

## Deployed — X Layer testnet (chain 1952)

| Contract | Address | |
|---|---|---|
| `IssuerRegistry` | [`0x57873ccC430f7709ed77dA7da1EC521CED877F59`](https://www.oklink.com/xlayer-test/address/0x57873ccc430f7709ed77da7da1ec521ced877f59) | Verified |
| `NoteFactory` | [`0xc430C8EE28AaaCbaBFE06CdB6A6900cE616DD357`](https://www.oklink.com/xlayer-test/address/0xc430c8ee28aaacbabfe06cdb6a6900ce616dd357) | Verified |
| `MockUSDG` | [`0x6AF29b12f4df68C9416A0DC87B80a718ed054A94`](https://www.oklink.com/xlayer-test/address/0x6af29b12f4df68c9416a0dc87b80a718ed054a94) | Verified · testnet only |

`RWANote` and `RepaymentVault` are deployed per agreement by `NoteFactory`; read them from its `NoteMinted` events. Full record in [contracts/deployments/xlayer-testnet.json](contracts/deployments/xlayer-testnet.json).

**X Layer testnet is chain 1952**, confirmed against the RPC — `eth_chainId` returns `0x7a0` on both `xlayertestrpc.okx.com` and `testrpc.xlayer.tech`. The 195 figure that circulates is wrong. Mainnet is 196.

## Running it

```bash
pnpm install                      # workspace: web + packages/core

cd backend
cp .env.example .env              # add GEMINI_API_KEY, R2_* for file storage
bun install
bun run db:up                     # Postgres in Docker
bun run db:migrate
bun run db:seed                   # sample documents, no model key needed
bun run dev                       # :8787

cd ../web
cp .env.example .env.local        # addresses are in the deployments JSON
pnpm dev                          # :3000

cd ../contracts
forge test                        # 66 tests
```

The seed loads both sample documents with hand-written extractions, so the review flow works without a model key or any spend. The validator runs for real over them.

## Scope and honesty statement

This is a hackathon prototype. It uses sample documents and mock loans on X Layer testnet.

**Deliberately out of scope:** legal enforceability, SPV wrappers, custody, regulated investor onboarding, and secondary-market liquidity. Creating a token is the easy part; proving a loan is trustworthy and sellable is the hard part, and TokenForge does not claim to solve it.

**Partially stubbed:** issuer verification. The `IssuerRegistry` and its on-chain enforcement are real — an unregistered address genuinely cannot mint — but admission to the registry is a manual off-chain decision here, not a KYB integration.

**What is real:** the document-to-validated-terms pipeline running against a live model, the deterministic validator, document storage with on-chain-matching hashes, and the repayment logic with 66 passing tests.

## What is not built yet

Stated plainly, because a demo can hide these:

- **No PDF text extraction.** `POST /documents` stores and hashes the file, but the text layer for extraction has to be supplied alongside it. There is no OCR step.
- **No note has been minted from the UI.** The mint is wired to `NoteFactory` and signed by the connected wallet, but it has only been exercised in tests — signing needs a real wallet in a browser.
- **No note exists on-chain.** The mint → deposit → claim lifecycle has only ever run in Foundry, not on testnet.
- **Confidence calibration is unmeasured.** It varies run to run and does produce mid-range values, but whether it is *well* calibrated across many documents is unknown. One document run three times is not evidence.

## Status

Day 4 of 12.
