# Sample documents

Four PDFs for exercising the pipeline, covering the paths that matter rather
than four variations on the same happy case.

```bash
bun ../backend/scripts/check-pdf.ts *.pdf   # what the parser sees, before spending on a model call
```

| | What it exercises |
|---|---|
| `1-meridian-sme-loan.pdf` | The happy path. Interest-only, $2.5M at 8.50%, twelve quarterly coupons of $53,125 and principal at maturity. Should extract cleanly and validate |
| `2-halcyon-contradictory-note.pdf` | **The refusal.** Clause 2 states 6.00% but defers to an unstated "blended rate"; the payment table implies about 9.40%. The model should extract the *stated* rate at low confidence rather than reconcile it, and the validator should block the mint outright |
| `3-atlas-amortizing-loan.pdf` | Amortisation. $1,000,000 at 10% over the term, five instalments of $200,000 principal plus $20,000 interest. Once minted, each repayment shrinks every holder's balance — a 100-token holding becomes 90 |
| `4-kestrel-invoice.pdf` | A different instrument. A single-payment receivable at a discount, ACT/365, no instalments — nothing like the loans above |

## What to look for

**Confidence is the point, not decoration.** Fields below 0.9 route to a human.
Watch which ones land there and whether the reason given is a real one.

**`INVALID` and `NEEDS_REVIEW` are different.** The first cannot be cleared by
confirming anything, because the arithmetic does not hold. The second is
waiting for someone to vouch for a field. Halcyon should be the first.

**Quotes should point at real text.** Every value carries the span it was read
from, highlighted in the source pane. A quote that cannot be found in the
document caps that field's confidence — deliberately, since a citation to
invented text is exactly what a reviewer would not catch by eye.

## Regenerating

Sources are in `src/`. They are wrapped at 76 columns before rendering, because
the renderer wraps at a fixed width and would otherwise split words mid-token —
which is a fair test of the parser but a poor test of everything downstream.

```bash
for f in src/*.txt; do
  fold -s -w 76 "$f" > /tmp/w.txt
  cupsfilter /tmp/w.txt > "$(basename "$f" .txt).pdf"
done
```

## Not covered

**A scan.** None of these is an image-only PDF, so the no-text-layer path is
untested by this set. Print one and photograph it to try that; the service
should refuse it with a 422 rather than pass an empty document to the model.
