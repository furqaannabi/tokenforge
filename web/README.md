# TokenForge web app

Next.js 16 (App Router, Turbopack) · Tailwind v4 · shadcn/ui · wagmi + Reown AppKit.

```bash
cp .env.example .env.local
pnpm dev          # :3000 — run pnpm install from the repository root
```

## Screens

| Route | |
|---|---|
| `/` | Issuer dashboard. Upload entry point, issuer verification panel, notes table |
| `/review/[id]` | The centrepiece: source document beside extracted terms |
| `/note/[id]` | Live note — repayment schedule, coupon deposit, document hash |
| `/registry` | Issuer registry |

## The review screen

The one screen worth describing. Source document on the left, extracted terms on
the right, and the two are linked: every value carries the verbatim clause it was
read from, matched by exact substring, so hovering either side highlights the
other. A model that cites text it invented cannot be highlighted, which is why
the service checks quotes really appear in the document and forces the field
into review when they do not.

Below `lg` the two panes cannot sit side by side, so one shows at a time behind
a toggle, defaulting to the terms.

An id is resolved as a local sample first and only then against the extraction
service, so the demo documents work whether or not the service is running.

**Settlement currency is not among the term cards.** No loan agreement names a
stablecoin — the paper says "$" — so it is chosen beside the mint action, as the
issuance decision it is.

## Design

Dark navy and slate. Depth comes from tonal layers and 1px outlines, never
shadows. One palette, expressed in shadcn's variable names, plus three semantic
accents that are never decorative:

- **verified** (emerald) — registered issuer, high confidence, settled on-chain
- **review** (amber) — low confidence, awaiting verification, pending
- **impaired** (red) — missed payment, failed validation, reverted mint

Inter throughout; JetBrains Mono for hashes, addresses, confidence scores, and
every figure in a data column, with tabular figures so they align.

Badges are rectangles rather than pills — they stand in for stamps on a legal
document.

## Notes

`@tokenforge/core` ships TypeScript source rather than a build artifact, so the
schema and validator have exactly one definition shared with the service. Next
compiles it via `transpilePackages`.

`next.config.ts` aliases five `@x402/*` modules to a stub. AppKit's wagmi adapter
barrel-imports every connector including Coinbase's Base Account one, which
statically imports packages it declares as *optional* peers — so they are absent
and the bundler cannot resolve them. Nothing here constructs that connector.
