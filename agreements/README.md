# Agreements

Real loan agreements, as filed. Pulled from SEC EDGAR full-text search and
converted to PDF exactly as a user would upload one.

Two of the three were written for a real transaction by people with no idea
this pipeline exists, which is the only way to find out what it does with input
it was not tuned against. The third is the hand-built fixture the contract tests
are shaped around, kept because a corpus where nothing succeeds cannot tell you
whether success still works.

## What is here

| | Pages | Chars | Maturity | Outcome |
|---|---|---|---|---|
| `northbridge-past-due-facility.pdf` | 3 | 3k | 2027-06-15 | **Validates.** Six quarterly instalments, tabulated in the document, and every column balances as read |
| `branchout-food-inc.pdf` | 2 | 2k | 2028-03-01 | **Validates**, and needs a human first: the rate and the day-count are genuinely unclear in the note |
| `hall-of-fame-port-authority-loan.pdf` | 8 | 18k | 2044-06-30 | **Blocked.** No rate and no schedule — both live in referenced documents |

`edgar-search.json` and `edgar-search-notes.json` are the two searches that
found them — 835 and 2,728 hits respectively, so there are plenty more.

```bash
bun ../backend/scripts/check-pdf.ts *.pdf   # what the parser sees
```

### BranchOut used to be blocked, and what changed

Its schedule appears nowhere in the document. One sentence gives the whole
thing — *"twenty-four (24) equal monthly installments of $67,840.94 ... the
first installment payable on April 1st, 2026"* — and the model built the table
from it. The dates were right, the payments were right, and the rows summed to
exactly 24 x 67,840.94. The split between principal and interest was 336.79
out, so the principal column did not retire the principal and the validator
refused it.

That split is now computed rather than extracted, which is why the document
passes. It is worth being precise about what moved: nothing the note states
changed hands. The model still reads the principal, the instalment, the count
and the dates out of prose; only the allocation between two columns is solved
for in code, and only when the column does not already balance. Documents that
tabulate their own schedule — the Northbridge fixture — are never touched.

### The ten that were removed

Ten agreements were dropped because their maturity date has already passed, and
a matured note cannot be issued at any point in the future. They were blocked by
a fact about the calendar rather than by anything the pipeline did, so they
measured nothing and cost a model call each to re-confirm it.

They are in git history, and `loop-media-agile-lending.pdf` is worth restoring
if the refusal behaviour ever needs demonstrating again — a 39% facility repaid
in 30 instalments, where the model called the frequency "monthly" at confidence
`0.4` because the payments are actually weekly, and the validator caught what
that implies:

```bash
git checkout 7ac2393 -- agreements/loop-media-agile-lending.pdf
```

The hand-written fixtures that predate all of this are in history too, and are
where to go for a document that reaches a mint:

```bash
git checkout 4c2d297 -- samples/6-northbridge-past-due-facility.pdf
git mv samples/6-northbridge-past-due-facility.pdf agreements/
```

## What the two show

**BranchOut is the extractor's own limit.** The note says *"24 equal monthly
instalments of $67,840.94"* and never tabulates a schedule, so the model builds
one. That instalment is a blended payment, and splitting it into principal and
interest is arithmetic the document does not do for it. The principal column
lands within about 200 of the stated 1,500,000 — close, and closeness is not
what a repayment schedule is for, so the validator refuses it.

Read it twice and the two readings disagree, which is the more useful finding:
the same model, the same prompt, a minute apart, producing different schedules
from the same sentence. That is what a derived value looks like from the
outside, and it is why the pipeline now reads every document twice.

**Hall of Fame is the quiet one.** The exhibit carries no interest rate at all,
and the model returned `0` at confidence `0` rather than inventing something
plausible. The schedule comes back empty for the same reason — the economics
live in a referenced note the exhibit never reproduces. Refusing to answer is
the behaviour that matters most here, and it is the hardest to demonstrate any
other way.

Its principal, meanwhile, is extracted at `0.99`: the document states that
plainly, and the model is confident exactly where it should be. One document,
both behaviours.

## What they establish

**No confident wrong answers.** Across every filed agreement run through this
pipeline, not one produced a high-confidence value that was false. Where a
document was silent the model said so, and the deterministic checks stopped
every one before a mint.

**What the pipeline is for, stated precisely.** An agreement that states its own
economics goes through, whether it tabulates the schedule or gives the one
sentence the schedule can be derived from. What is refused is a document whose
terms live somewhere it cannot read — an annex, a referenced note, a rate the
exhibit never names. These three are what that boundary looks like from either
side of it.

**Where to look for more.** Filtering EDGAR to recent filings is the cheapest
way to widen the corpus, and avoids re-collecting the matured filings that were
just removed.
