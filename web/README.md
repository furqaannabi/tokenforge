# TokenForge web app

Next.js 16 (App Router, Turbopack) · Tailwind v4 · shadcn/ui · wagmi + Reown AppKit.

```bash
cp .env.example .env.local
pnpm dev          # :3000 — run pnpm install from the repository root
```

## Screens

Three routes. Browsing, holding, issuing, applying and admitting were five, and
four of them were empty for most visitors — a wallet holding nothing has no
portfolio, an unregistered one cannot issue, and exactly one address in the
world can use the admin queue. Splitting them across a nav advertised doors that
would not open.

| Route | |
|---|---|
| `/` | The workspace. Tabs, each appearing only when the chain says the viewer can use it |
| `/review/[id]` | The centrepiece: source document beside extracted terms |
| `/note/[id]` | Live note — offering, repayment, claims, provenance |

| Tab | Shown to |
|---|---|
| All notes | Everyone, wallet or not |
| My notes | A connected wallet — its positions and claims |
| New note | A wallet the registry has admitted |
| Registry | Everyone — apply, and see who was admitted |
| Admin | Only the address `IssuerRegistry` names as admin |

The selection lives in the query string, so a tab is still a link someone can
send, and an unknown or newly-hidden one falls back to the first rather than
rendering blank — which is what disconnecting while on My notes would otherwise
do. The old paths redirect.

With nothing left to navigate to, the top bar carries the brand and the wallet
and stops there.

## The review screen

The one screen worth describing. Source document on the left, extracted terms on
the right, and the two are linked: every value carries the verbatim clause it was
read from, matched by exact substring, so hovering either side highlights the
other. A model that cites text it invented cannot be highlighted, which is why
the service checks quotes really appear in the document and forces the field
into review when they do not.

Below `lg` the two panes cannot sit side by side, so one shows at a time behind
a toggle, defaulting to the terms.

**Three things sit beside the mint action rather than among the term cards**,
because no loan agreement contains any of them. The settlement currency — the
paper says "$", not which stablecoin. The borrower's wallet — the document names
a company, not an address it controls. And what share of the supply to place for
sale. All three are issuance decisions, and presenting them as extracted values
would misrepresent where they came from.

The offering has no price field. A token is a claim on one unit of principal, so
the desk computes par and the screen shows what a given percentage raises.

## The note screen

An investor is asked for an amount of money, not a number of tokens. On a
2,500,000 loan split a thousand ways a token costs 2,500, and asking for "tokens
to buy" made someone with 500 work out that they wanted 0.2 of one. The ledger
is 18-decimal, so fractions were always purchasable; only the question was
wrong. Percentage buttons take their share of whatever the buyer could actually
spend — their balance or the whole pool, whichever runs out first.

"What you'd receive" opens their share of every remaining instalment, read from
the vault's own schedule rather than the extracted one. Settled periods are
excluded: a buyer's shares are checkpointed against the distribution accumulator
the moment they arrive, so instalments paid before they bought are not theirs.

Repay is shown to the borrower alone. `settleNextPeriod` pulls from whoever
signs it, so offering it to a holder offered them the chance to pay someone
else's loan out of their own pocket.

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
