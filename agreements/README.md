# Agreements

Real loan agreements, as filed, pulled from SEC EDGAR full-text search and
converted to PDF exactly as a user would upload one. They are here as evidence
about the extractor rather than as demo fixtures — neither can be minted, and
that is the finding rather than a defect.

The hand-written fixtures that used to live here were removed in favour of
them. They remain in git history at `4c2d297`, which is where to go if a
self-contained document is needed for a demo:

```bash
git checkout 4c2d297 -- samples/6-northbridge-past-due-facility.pdf
# then: git mv samples/6-northbridge-past-due-facility.pdf agreements/
```

| | |
|---|---|
| `hall-of-fame-port-authority-loan.pdf` | Stark County Port Authority to Hall of Fame Resort. 8 pages, 18k chars |
| `loop-media-agile-lending.pdf` | Agile Lending to Loop Media. 33 pages, 88k chars |
| `edgar-search.json` | The search that found them — 835 hits, so there are more |

```bash
bun ../backend/scripts/check-pdf.ts *.pdf   # what the parser sees
```

## What happened

Both extracted the parties, the principal and the dates at high confidence.
Both were then **blocked by the validator**, for real reasons:

**Hall of Fame** — the exhibit carries no interest rate and no repayment
schedule; they live in documents it references. The model returned a rate of
`0` at confidence `0` rather than inventing one, and the validator refused a
0% note and an empty schedule.

**Loop Media** — a 39% facility repaid in 30 instalments. The model called the
frequency "monthly" at confidence `0.4`, hesitating exactly where it should:
the payments are weekly. The validator then caught what that implies —
*"30 payments, but a monthly schedule over this term implies about 7"* — along
with a maturity already in the past and interest that does not reproduce the
stated rate.

## What this is evidence of

**The safety claim holds on documents nobody wrote for it.** Neither produced a
confident wrong number. Where the document did not say, the model said it did
not know, and the deterministic checks stopped both before a mint.

**The coverage claim does not.** A filed agreement routinely keeps its
economics somewhere else — an annex, a schedule exhibit, a separate note — so
"upload any loan agreement and tokenize it" is not true today. Extraction from
a single self-contained document is.

That distinction is worth more than a passing test would have been. It is also
why a self-contained agreement that validates end to end is worth hunting for in
the remaining EDGAR results.


## The wider trial — twelve agreements, none mintable

Ten more were pulled with a second search aimed at self-contained notes
(`edgar-search-notes.json`, "equal monthly installments" + "promissory note").
The one-off script that ran them is gone; the results are the artifact worth
keeping, and re-running it means uploading these through the app.
Every one was blocked. The reasons fall into four groups, and only one of them
is a fault in the extractor.

| Blocked because | Count | Whose problem |
|---|---|---|
| Maturity already in the past | 5 | The search, not the product — these are historical filings |
| No schedule in the document | 5 | The agreement states instalments in prose, or defers to an annex |
| Schedule does not sum to the principal | 3 | **The extractor** — see below |
| Rate absent or stated elsewhere | 3 | The agreement |

### The one worth fixing

Where a note says *"repayable in 24 equal monthly instalments of $67,840"*, the
model builds a schedule from that sentence — and the instalment is a blended
payment, so the principal column ends up carrying interest too. BranchOut Food
came out at 1,628,182 against a stated principal of 1,500,000, and Elixir
Gaming at 9,164,813 against 9,163,809.

The validator caught both, which is the system working. But the derivation is
what is wrong, not the check: either the model should split a blended
instalment into principal and interest, or it should decline to synthesise a
schedule the document does not tabulate and say so.

### What the twelve establish

**No confident wrong answers.** Across twelve agreements nobody wrote for this
system, not one produced a high-confidence value that was false. Where the
document was silent the model said so and the validator refused.

**Coverage is narrower than the pitch.** "Upload a loan agreement and tokenize
it" is not true. "Upload a self-contained agreement that tabulates its own
schedule" is, and that is a defensible claim rather than a hopeful one.
