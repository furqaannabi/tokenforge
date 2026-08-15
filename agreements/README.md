# Agreements

Twelve real loan agreements, as filed. Pulled from SEC EDGAR full-text search
and converted to PDF exactly as a user would upload one.

They are here as **evidence about the extractor**, not as demo fixtures. Not
one of them can be minted, and that is the measurement rather than a defect —
it is the first time this pipeline has been asked to read documents nobody
wrote for it.

The hand-written fixtures that used to live here were removed in favour of
them. They remain in git history, which is where to go when a demo needs a
document that reaches a mint:

```bash
git checkout 4c2d297 -- samples/6-northbridge-past-due-facility.pdf
git mv samples/6-northbridge-past-due-facility.pdf agreements/
```

## What is here

| | Pages | Chars | Blocked because |
|---|---|---|---|
| `branchout-food-inc.pdf` | 2 | 2k | Schedule totals 1,628,182 against a stated principal of 1,500,000 |
| `college-partnership-inc.pdf` | 9 | 30k | No rate in the document |
| `elixir-gaming-technologies-inc.pdf` | 5 | 16k | Schedule totals 9,164,813 against a stated 9,163,809 |
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
payment, so interest ends up counted in the principal column: BranchOut Food
came out at 1,628,182 against a stated 1,500,000, and Elixir Gaming at
9,164,813 against 9,163,809.

The validator caught both, which is the system working. But the derivation is
what is wrong, not the check. Either the model should split a blended
instalment into principal and interest, or it should decline to synthesise a
schedule the document never tabulated and say so — the second is closer to how
the rest of this project behaves.

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

**Coverage is narrower than the pitch.** "Upload a loan agreement and tokenize
it" is not true today. "Upload a self-contained agreement that tabulates its
own schedule, and refuse anything that cannot be verified" is — a narrower
claim, and one that survives contact with real documents.

**A useful next search.** Filtering EDGAR to recent filings would clear the
five past-maturity failures immediately, which is the cheapest way to find a
real agreement that validates end to end.
