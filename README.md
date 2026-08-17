<img src="web/public/logo.png" alt="" width="80" />

# TokenForge

**Only verified issuers can turn real financial agreements into programmable onchain assets.**

Upload a loan agreement, invoice, or bond term sheet; an AI extracts the economic terms with per-field confidence scores; after human review and issuer approval, a cash-flow-programmed RWA token is minted on X Layer and its coupons pay holders in USDG.

## The problem

Tokenizing a real-world debt instrument today means a human reads a non-standardized legal PDF and manually transcribes principal, rate, day-count, maturity, schedule, and covenants into a contract deployment. That transcription step is the bottleneck, and it doesn't scale.

TokenForge puts an LLM on that critical path. Remove the model and there is no product — only manual paralegal data entry.

## How it works

```text
Issuer and borrower are admitted to the registry, under separate roles
        ↓
Verified issuer uploads the signed PDF     → stored in R2, hashed, text read out
        ↓
AI extracts terms with per-field confidence
        ↓
Deterministic validator checks internal consistency
        ↓
AI checks whose document it is, and whether we have seen it before
        ↓
Human reviews low-confidence fields
        ↓
Issuer submits the exact parameters for approval
        ↓
Borrower signs those exact parameters from their own wallet
        ↓
Registry admin clears the same parameters on-chain
        ↓
Issuer mints — the factory recovers the borrower's signature   → the note opens Active
        ↓
Issuer places a share of the note on the sale desk
        ↓
Investors buy in and hold proportional shares
        ↓
Borrower deposits USDG repayments
        ↓
Holders claim principal + interest pro-rata
```

### Three parties, kept apart

A loan has three sides, and collapsing any two of them tells a lie:

| | |
|---|---|
| **Issuer** | Originated the loan and is selling it to get their capital back early. Mints the note, holds the whole supply, places part of it for sale |
| **Borrower** | Owes the money. Named at issuance, must be in the registry, and signs the exact mint parameters before anything is minted. Repays into the vault |
| **Holders** | Own the repayments. Buy from the offering, claim their share, and can sell on |

Until the borrower accepts, a minted note is only the issuer's assertion *about*
someone else — so it stays `Pending` and cannot be transferred, offered, or
repaid. Only that wallet's own key can clear it.

They sign once. The signature covers the exact mint parameters, gates the
admin's approval, and is then carried into the mint itself, where the factory
recovers it and opens the note `Active`. The borrower pays no gas and never
agrees twice; the chain verifies the agreement rather than trusting that a
database row recorded it. A mint sent without a signature still opens `Pending`
and waits for `accept()`.

Paying, though, is open to anyone. A guarantor or a servicer may legitimately
settle a period, and restricting it to one address would let a lost key strand
a performing loan.

### Automatic repayment

The borrower grants the vault a standing allowance in the settlement currency.
Once an instalment falls due, `collectFromBorrower` pulls exactly the scheduled
amount and credits it across the holders. A keeper in the service sweeps every
few minutes and makes the call for any vault that is due.

Three properties are the whole design:

- **There is nothing to cancel.** The authorization *is* an ERC-20 allowance.
  The borrower lowers it and collection stops on the next block — no
  counterparty, no notice period, no one to ask. Verified: with the instalment
  due and the allowance revoked, the keeper collects nothing and the balance is
  untouched.
- **The keeper cannot take anything.** `collectFromBorrower` has no arguments
  and no recipient. It moves the scheduled amount, from the borrower named by
  the note, into that note's vault, only once due, only as far as the borrower's
  own allowance permits. Whoever holds the keeper key can pay other people's
  debts on time; that is the entire privilege, which is why a hot key is
  acceptable and why the call is unpermissioned.
- **Automation is never the only route.** Because the call is open, the note
  page offers a "Collect now" button to anyone. An automation that only its
  operator can run is one nobody else can verify.

An allowance is permission, not money set aside — the balance still has to be
there on the day, and the panel says so.

Set `KEEPER_PRIVATE_KEY` to switch the sweep on; without it nothing collects
automatically and repayment still works by hand. `GET /keeper` reports whether
it is running and what it last did.

## The trust stack

No single check is trusted on its own. Five layers each do a different job:

| Layer | What it establishes |
|---|---|
| Company verification | Corporate identity and an authorized representative; only registered issuers can mint |
| AI verification | Extracts terms, cross-checks the document, flags inconsistencies, scores confidence |
| Human verification | A person reads the source document and confirms or corrects the AI's output |
| Issuer approval | The authorized representative signs off on the final terms on-chain |
| Document provenance | A model checks the agreement names this issuer as lender, and that the same loan has not already been tokenized under a different file |
| Borrower acceptance | The borrower signs the mint hash from their own wallet, and `NoteFactory` recovers that signature on-chain before the note opens. Without it the note mints `Pending` and nothing trades or settles |
| Admin approval | The registry admin clears one exact set of mint parameters. Editing anything afterwards produces a different hash and the factory refuses it |
| Wallet sessions | Reads and writes are scoped to the wallet that signed a challenge, not merely to one that is connected. A minted note stays public; anything in review does not |
| Onchain enforcement | Terms are immutable, the document hash is recorded, the repayment schedule is enforced by contract |

**Issuer verification is an eligibility layer, not a safety guarantee.** A reputable company can still originate a bad loan. Verification controls *who may issue*; it says nothing about whether a particular loan will be repaid. Credit risk remains entirely with the investor.

## Handling uncertainty

An LLM cannot extract facts a document was written to obscure. TokenForge is built around that limit rather than pretending it away.

The four checks fail independently, and the difference matters:

- **Confidence scoring** comes from a model pass that audits a reading against the source. It answers *how sure was the model*.
- **The cross-check** reads the document a second time, independently, and compares the two readings. It answers a question no audit of a single reading can: *does the extractor agree with itself*. A reading can be internally tidy, cite real clauses, and still not be the answer the same model gives the same document a minute later — and where the two differ, the field is capped and sent to a human rather than reconciled.
- **The deterministic validator** is rules, not AI. It checks that dates are ordered, principal reconciles, the cadence matches the declared frequency, and the schedule reproduces the stated rate against a declining balance. It ignores confidence entirely — terms a model was certain about still fail when the arithmetic doesn't hold.
- **Human review** clears low-confidence fields. Terms can be arithmetically perfect and still too uncertain to mint unsupervised.

### What the model is trusted with, and what it is not

The model reads. It does not compute.

Everything a document *states* comes from the model, and nothing else could get
it: the parties, the principal, the rate, the day-count, the dates, and — where
a note gives one sentence instead of a table — the payment amounts and the day
each one falls due, recovered from prose like *"twenty-four (24) equal monthly
installments of $67,840.94 ... the first installment payable on April 1st,
2026"*. Every value arrives with the verbatim clause it came from and a
confidence score. Remove the model and there is no product.

What the model is not asked for is arithmetic. Splitting an instalment into
principal and interest across twenty-four periods is a solved calculation with
one right answer, and a language model gets it nearly right — which is the worst
possible outcome, because nearly right looks like right. Measured on BranchOut:
128,182 out on the first attempt, 336.79 out after the prompt spelled out the
arithmetic, and it was never going to reach zero. So the split is solved in
code from the payments the model read, and only when the column does not
already balance ([`amortise.ts`](packages/core/src/amortise.ts)).

The boundary is the point. A model that reads a non-standardised legal PDF is
doing something nothing else can; a model doing long division is a liability
with a confidence score attached.

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

## Zoya

An assistant that can only read. She answers questions about notes, schedules,
positions and blocked mints by calling tools that query the chain and the
extraction records — the same reads the interface makes — and the panel prints
which tools an answer rested on, so a figure can be checked rather than
believed.

She may not state a number she did not read from a tool. That constraint is the
point rather than a caveat: this product's whole claim is that it does not trust
a copy, and an assistant is the easiest place to abandon that quietly. Asked for
a typical yield she declines and offers to look up a specific note; asked to buy
she says she cannot and points at the button; told to confirm the notes are
protocol-guaranteed she refuses and says where credit risk actually sits.

Nothing she can call writes. `backend/src/abi.ts` carries view functions only.

## Layout

```text
packages/core   Extraction schema and deterministic validator — one copy,
                imported by both the web app and the service
backend         Hono on Bun · Prisma over Postgres · R2
                Claude Sonnet 4.6 on Amazon Bedrock reads the agreements;
                Haiku 4.5 transcribes scans, which is reading not reasoning
                PDFs parsed on upload; scans transcribed by the model
web             Next.js · wagmi/viem · Reown AppKit
contracts       Foundry · deployed and verified on X Layer testnet
```

`packages/core` exists because the validator decides whether terms may reach a contract. Two copies would eventually disagree — a reviewer's browser approving what the server would refuse, or worse the reverse.

## Deployed — X Layer testnet (chain 1952)

| Contract | Address | |
|---|---|---|
| `IssuerRegistry` | [`0x728CbFFbA7a513c5D915fFBf561D8E1983EED3E9`](https://www.oklink.com/xlayer-test/address/0x728cbffba7a513c5d915ffbf561d8e1983eed3e9) | Verified |
| `NoteFactory` | [`0xb2898abC5CE84148c80F91483e74fb38A3Ae07cc`](https://www.oklink.com/xlayer-test/address/0xb2898abc5ce84148c80f91483e74fb38a3ae07cc) | Unverified — see below |
| `SaleDesk` | [`0x33C3Da08E7e214c9F02Dae4C92D0CD55747f8181`](https://www.oklink.com/xlayer-test/address/0x33c3da08e7e214c9f02dae4c92d0cd55747f8181) | Verified |
| `MockUSDG` | [`0x6AF29b12f4df68C9416A0DC87B80a718ed054A94`](https://www.oklink.com/xlayer-test/address/0x6af29b12f4df68c9416a0dc87b80a718ed054a94) | Verified · testnet only |

`NoteFactory` is the one contract OKLink will not verify, and it is scale
rather than settings. It embeds the creation code of both the note and the
vault, which makes it 26 sources and 22.2KB deployed, against 4.3KB for the
registry and 5.6KB for the desk — and those two verify through the same
endpoint, with the same pinned compiler, in the same submission. The endpoint
accepts the payload and then reports it cannot reproduce the bytecode.

Compiler settings are pinned in `foundry.toml` — `evm_version = "cancun"` and
`bytecode_hash = "none"` — so nothing here drifts when the toolchain updates,
and a verifier compiles at the same target. That was worth doing regardless: an
unpinned EVM version means Foundry silently retargets a newer fork under a
contract already deployed, and it had already picked `prague`.

A primary sale carries a protocol fee of 25 basis points on **each** side: the
buyer pays the price plus 0.25%, the seller receives it less 0.25%, and both
legs reach the treasury in the same transaction. On a 1,000 sale that is
1,002.50 out, 997.50 in, and 5.00 to the protocol. The rate and the treasury are
immutable, so a sale cannot be repriced between a buyer's quote and their
confirmation.

`RWANote` and `RepaymentVault` are deployed per agreement by `NoteFactory`; read them from its `NoteMinted` events. Full record in [contracts/deployments/xlayer-testnet.json](contracts/deployments/xlayer-testnet.json), including superseded addresses and why each was replaced.

`NoteFactory` and `SaleDesk` have both been redeployed. Earlier factories minted
notes with no borrower, which the app still reads and treats as payable by the
issuer; earlier desks let the issuer name their own price, and the first of them
quoted zero for amounts small enough to round down.

No notes are live: the database was reset when the registry and factory were
last replaced. Earlier notes remain on-chain under the superseded factories
but are no longer indexed.

**X Layer testnet is chain 1952**, confirmed against the RPC — `eth_chainId` returns `0x7a0` on both `xlayertestrpc.okx.com` and `testrpc.xlayer.tech`. The 195 figure that circulates is wrong. Mainnet is 196.

## Running it

```bash
pnpm install                      # workspace: web + packages/core

cd backend
cp .env.example .env              # set AWS_REGION, R2_* for file storage
bun install
bun run db:up                     # Postgres in Docker
bun run db:migrate
bun run db:seed                   # sample documents, no model key needed
bun run dev                       # :8787

cd ../web
cp .env.example .env.local        # addresses are in the deployments JSON
pnpm dev                          # :3000

cd ../contracts
forge test                        # 126 tests
```

The seed loads two documents with hand-written extractions, so the review flow works without a model key or any spend. The validator runs for real over them.

For the full pipeline, [agreements/](agreements/) has three documents to upload: one that validates as read, one that validates but sends two genuinely unclear fields to a human first, and one that is refused because its rate and schedule live in a document it references but never reproduces. See that directory's README.

The registry deploys empty. Before a mint will go through, a wallet has to apply as an issuer, be approved, and be admitted on-chain — and the borrower has to be admitted separately, under its own role.
