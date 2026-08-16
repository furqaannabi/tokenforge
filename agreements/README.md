# Agreements

Twelve real loan agreements, as filed. Pulled from SEC EDGAR full-text search
and converted to PDF exactly as a user would upload one.

This is the **test corpus**, not a set of demo fixtures. Every one of these
documents was written for a real transaction by people with no idea this
pipeline exists, which is the only way to find out what it does with input it
was not tuned against. None of the twelve reaches a mint, and each is blocked
for a different and legible reason — which is what makes them useful to keep.

The hand-written fixtures that used to live here were removed in favour of
them. They remain in git history, which is where to go for a document that
reaches a mint: 

```bash
git checkout 4c2d297 -- samples/6-northbridge-past-due-facility.pdf
git mv samples/6-northbridge-past-due-facility.pdf agreements/
```

## What is here

| | Pages | Chars | Blocked because |
|---|---|---|---|
| `branchout-food-inc.pdf` | 2 | 2k | Schedule totals 1,500,387 against a stated principal of 1,500,000, and the two readings of it disagree |
| `college-partnership-inc.pdf` | 9 | 30k | No rate in the document |
| `elixir-gaming-technologies-inc.pdf` | 5 | 16k | Schedule totals 9,166,308 against a stated 9,163,809, and the two readings of it disagree |
| `golden-phoenix-minerals-inc-mn.pdf` | 8 | 21k | No schedule; rate uncertain |
| `hall-of-fame-port-authority-loan.pdf` | 8 | 18k | No rate and no schedule — both live in referenced documents |
| `loop-media-agile-lending.pdf` | 33 | 88k | Maturity past; 30 payments against a "monthly" reading |
| `national-investment-managers-inc.pdf` | 1 | 2k | No rate; schedule totals 405,000 against a stated 475,000 |
| `nevada-gold-casinos-inc.pdf` | 11 | 21k | Maturity past; no schedule |
| `ricks-cabaret-international-inc.pdf` | 2 | 11k | Maturity past; no schedule |
| `sanomedics-international-holdings-.pdf` | 7 | 20k | Maturity past; no schedule; most fields uncertain |
| `telkonet-inc.pdf` | 3 | 8k | Maturity past; final payment six years before maturity |
| `vertical-computer-systems-inc.pdf` | 3 | 17k | See the trial output |

`edgar-search.json` and `edgar-search-notes.json` are the two searches that
found them — 835 and 2,728 hits respectively, so there are plenty more.

```bash
bun ../backend/scripts/check-pdf.ts *.pdf   # what the parser sees
```

## Why each one stopped

Four groups, and only one of them is a fault in this project.

| | Count | Whose problem |
|---|---|---|
| Maturity already in the past | 5 | The search — no date filter, so these are historical filings |
| No schedule in the document | 5 | The agreement defers to an annex or a referenced note |
| Schedule does not sum to the principal | 3 | **The extractor** |
| Rate absent or stated elsewhere | 3 | The agreement |

### The one worth fixing

Where a note says *"repayable in 24 equal monthly instalments of $67,840"*, the
model builds a schedule out of that sentence. The instalment is a **blended**
payment, so interest ended up counted in the principal column: BranchOut Food
came out at 1,628,182 against a stated 1,500,000, and Elixir Gaming at
9,164,813 against 9,163,809.

The validator caught both, which is the system working. But the derivation was
what was wrong, not the check.

Two changes since, and the second is the more useful one.

The extraction prompt now states the arithmetic that settles a blended
instalment — total interest is the instalments minus the principal, the
principal column sums to the stated principal, and the balance reaches zero on
the last row. BranchOut moved from 1,628,182 to 1,500,387. Better, and still
wrong by 387.

Then the **cross-check**: every document is read twice and the readings
compared. Run these four and the split is clean —

| | Schedule in the document | Two readings |
|---|---|---|
| Northbridge (the demo fixture) | tabulated | agree exactly |
| National Investment | tabulated | agree exactly |
| BranchOut Food | synthesised from one sentence | differ by 16 |
| Elixir Gaming | synthesised from one sentence | differ by 1,614 |

The documents that tabulate their own schedule are read the same way twice. The
documents where the model computes the schedule are not — and it is the same
model, the same prompt, a minute apart. That is the honest boundary of this
feature, and it is now drawn automatically rather than by someone noticing the
totals look odd.

Which leaves the original question answered by measurement rather than taste:
the model should decline to synthesise a schedule the document never tabulated.
Its own instability on exactly those documents is the argument.

### Two that are worth reading in full

**Loop Media** is the best single demonstration in the set. A 39% facility
repaid in 30 instalments; the model called the frequency "monthly" at
confidence `0.4`, hesitating exactly where it should, because the payments are
weekly. The validator then caught what that implies — *"30 payments, but a
monthly schedule over this term implies about 7"* — along with a maturity
already past and interest that does not reproduce the stated rate.

**Hall of Fame** is the quiet one. The exhibit carries no interest rate at all,
and the model returned `0` at confidence `0` rather than inventing something
plausible. Refusing to answer is the behaviour that matters most here, and it
is the hardest to demonstrate any other way.

## What the twelve establish

**No confident wrong answers.** Across twelve agreements written for other
purposes entirely, not one produced a high-confidence value that was false.
Where a document was silent the model said so, and the deterministic checks
stopped every one before a mint.

**What the pipeline is for, stated precisely.** A self-contained agreement that
tabulates its own schedule goes through; anything whose economics live in an
annex, a referenced note, or a sentence the model has to do arithmetic on is
refused rather than guessed at. These twelve are what that boundary looks like
from the outside, and it is drawn by the validator rather than by taste.

**Where to look for more.** Filtering EDGAR to recent filings clears the five
past-maturity blocks immediately, and is the cheapest way to widen the corpus.
