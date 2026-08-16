# Agreements

Real loan agreements, as filed. Pulled from SEC EDGAR full-text search and
converted to PDF exactly as a user would upload one.

This is the **test corpus**, not a set of demo fixtures. Both documents were
written for a real transaction by people with no idea this pipeline exists,
which is the only way to find out what it does with input it was not tuned
against.

## What is here

| | Pages | Chars | Maturity | Blocked because |
|---|---|---|---|---|
| `branchout-food-inc.pdf` | 2 | 2k | 2028-03-01 | Schedule totals 1,500,209 against a stated principal of 1,500,000, and two readings of it disagree |
| `hall-of-fame-port-authority-loan.pdf` | 8 | 18k | 2044-06-30 | No rate and no schedule — both live in referenced documents |

`edgar-search.json` and `edgar-search-notes.json` are the two searches that
found them — 835 and 2,728 hits respectively, so there are plenty more.

```bash
bun ../backend/scripts/check-pdf.ts *.pdf   # what the parser sees
```

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

**What the pipeline is for, stated precisely.** A self-contained agreement that
tabulates its own schedule goes through; anything whose economics live in an
annex, a referenced note, or a sentence the model has to do arithmetic on is
refused rather than guessed at. These two are what that boundary looks like from
either side of it.

**Where to look for more.** Filtering EDGAR to recent filings is the cheapest
way to widen the corpus, and avoids re-collecting the matured filings that were
just removed.
