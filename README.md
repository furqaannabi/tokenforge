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
Verified issuer uploads loan document
        ↓
AI extracts terms (principal, rate, maturity, schedule, covenants)
        ↓
Deterministic validator checks internal consistency
        ↓
Human reviews low-confidence fields
        ↓
Authorized issuer representative approves
        ↓
RWANote token minted on X Layer, source document hash stored on-chain
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

An LLM cannot extract facts a document was written to obscure. TokenForge is built around that limit rather than pretending it away:

- **Per-field confidence scores** from a second-pass self-verification plus internal cross-checks (does the extracted schedule reproduce the extracted rate?).
- **A deterministic validator** that blocks minting on inconsistent terms regardless of model confidence — the contract never receives unvalidated numbers.
- **Mandatory human review** of low-confidence fields, and mandatory issuer approval. Companies cannot self-mint investable tokens from an unchecked upload.

## Architecture

| Component | Stack | Role |
|---|---|---|
| Extraction service | TypeScript | PDF → OCR/text → LLM structured extraction → validator → confidence scoring. Exposed as an Onchain OS Skill / MCP tool |
| `IssuerRegistry` | Solidity / Foundry | Approved issuers, authorized-representative roles, revocation. Minting from an unregistered address reverts |
| `NoteFactory` | Solidity / Foundry | Deploys notes; stores the source document hash on-chain for provenance. Gated on registry membership |
| `RWANote` | Solidity / Foundry | ERC-20 with immutable term metadata and a transfer-allowlist hook (ERC-3643-ready) |
| `RepaymentVault` | Solidity / Foundry | Coupon schedule, USDG deposits, pro-rata claims, impairment on missed payment |
| Web app | Next.js + wagmi/viem | Upload → review → approve/mint → live token page |

## Scope and honesty statement

This is a hackathon prototype. It uses sample documents and mock loans on X Layer testnet.

**Deliberately out of scope:** legal enforceability, SPV wrappers, custody, regulated investor onboarding, and secondary-market liquidity. Creating a token is the easy part; proving a loan is trustworthy and sellable is the hard part, and TokenForge does not claim to solve it.

**Partially stubbed:** issuer verification. The `IssuerRegistry` and its on-chain enforcement are real — an unregistered address genuinely cannot mint — but admission to the registry is a manual off-chain decision here, not a KYB integration.

**What is real:** the document-to-validated-terms pipeline, the on-chain provenance binding, the programmable repayment logic, and the automated pro-rata distributions.

## Status

Day 1 of 12. Scaffolding in progress.
