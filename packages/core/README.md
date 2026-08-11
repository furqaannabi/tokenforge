# @tokenforge/core

The extraction schema and the deterministic validator. One copy, imported by
both the web app and the extraction service.

These two things belong together and must exist exactly once. The schema is the
contract with the model, the shape stored in Postgres, and the shape the review
screen renders. The validator decides whether a set of terms may reach a
contract at all. If a reviewer's browser and the server disagreed about that, it
would surface as terms passing review and then reverting on-chain — or worse,
terms minting that should not have.

## What is in it

**`schema.ts`** — zod schemas for the extracted terms. Written for structured
outputs, which require every property to be present, hence `.nullable()` rather
than `.optional()` throughout and no numeric range keywords. Ranges are the
validator's job anyway, since it has to check human edits too.

`ExtractedTerms` is derived from the zod shape by a mapped type that adds
`editedByHuman`. That flag is review state, not something a model reports, so it
has no place in the model contract — but deriving rather than redeclaring keeps
one source of truth for the shape.

**`validator.ts`** — rules, not AI. Day-count conventions (30/360, ACT/360,
ACT/365), date ordering, principal reconciliation, cadence against the declared
frequency, and whether the schedule reproduces the stated rate against a
declining balance. It ignores confidence entirely.

`fieldsNeedingReview` is the separate question, and honours sign-off from either
direction: a correction sets `editedByHuman` on the field, while confirming a
value as extracted changes nothing about it and is recorded as a key in a
confirmed set. Treating either as sufficient is what lets one implementation
serve both — and both callers must pass that set. The review screen once
recomputed from the terms alone, which ignored every confirmation ever made and
left the mint button permanently disabled on any document with one
low-confidence field.

`mintGate` combines them into the single question the review screen asks — may
these terms be minted? Three independent gates: registry membership, arithmetic
consistency, and human confirmation. Each blocks on its own.

## Notes

Settlement currency is deliberately **not** an extracted field. `CURRENCIES`
lives here, but which stablecoin a note pays in is an issuance decision made at
mint time, not a fact recorded in the agreement. `validateSettlementCurrency`
checks it separately, because it validates a decision rather than an extraction.

The package ships TypeScript source rather than a build artifact, so there is no
compile step between editing a rule and both consumers seeing it. Next needs
`transpilePackages` for that; Bun handles it directly.
