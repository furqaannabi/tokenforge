"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { parseUnits } from "viem";
import { Check, CircleAlert, Loader2, ShieldOff, TriangleAlert } from "lucide-react";
import { DocumentPane } from "@/components/document-pane";
import { TermCard, type EditorKind } from "@/components/term-card";
import { FieldLabel } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useExtraction,
  useRecordMintedNote,
  useReviewExtraction,
} from "@/lib/queries";
import { useMintNote } from "@/lib/mint";
import { useOpenOfferFor } from "@/lib/sale";
import { CURRENCY_DECIMALS } from "@/lib/contracts/mint";
import { SUPPLY_TOKENS } from "@/lib/issuance";
import { CHAIN_ID } from "@/lib/contracts";
import { extractionToNote } from "@/lib/adapt";
import { useWallet } from "@/lib/wallet";
import { DEMO_NOW } from "@/lib/clock";
import { mintGate, LOW_CONFIDENCE_THRESHOLD } from "@tokenforge/core";
import { money, shortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  CURRENCIES,
  DAY_COUNTS,
  PAYMENT_FREQUENCIES,
  type Currency,
  type PaymentPeriod,
  type TermField,
} from "@/lib/types";

/** Which control edits which field, and in what order the reviewer meets them. */
const EDITORS: Array<{
  field: TermField;
  kind: EditorKind;
  options?: readonly string[];
}> = [
  { field: "principal", kind: "number" },
  { field: "interestRatePct", kind: "percent" },
  { field: "dayCount", kind: "select", options: DAY_COUNTS },
  { field: "agreementDate", kind: "date" },
  { field: "maturityDate", kind: "date" },
  { field: "paymentFrequency", kind: "select", options: PAYMENT_FREQUENCIES },
  { field: "borrower", kind: "text" },
  { field: "lender", kind: "text" },
];

const STEPS = ["Upload", "Review Terms", "Approve", "Mint"] as const;

export function ReviewScreen({ noteId }: { noteId: string }) {
  const router = useRouter();
  const { issuer, address } = useWallet();
  const [activeField, setActiveField] = useState<TermField | null>(null);
  const [mintError, setMintError] = useState<string | null>(null);
  const minting = useMintNote();
  const openOffer = useOpenOfferFor();
  const recordMint = useRecordMintedNote(noteId);
  // Below lg the two panes cannot sit side by side, so one shows at a time.
  const [pane, setPane] = useState<"document" | "terms">("terms");
  // Issuance decisions, not extractions: no document states either of them.
  const [currency, setCurrency] = useState<Currency>("USDG");
  // Share of the supply to place for sale at issuance, and what the issuer
  // wants for it. Blank proceeds means par.
  const [salePct, setSalePct] = useState("");
  const [saleProceeds, setSaleProceeds] = useState("");

  const remote = useExtraction(noteId);
  const review = useReviewExtraction(noteId);

  const note = useMemo(
    () => (remote.data ? extractionToNote(remote.data, address) : undefined),
    [remote.data, address],
  );
  const terms = note?.terms;

  /*
   * The service owns the record of what a human has vouched for.
   *
   * Confirming a field as extracted changes nothing about the value, so
   * nothing is written onto the field — the fact lives in the extraction's
   * `unreviewedFields`. Recomputing the gate from the terms alone therefore
   * ignored every confirmation ever made, and the mint button stayed disabled
   * forever on any document that had a single low-confidence field. Anything
   * absent from that list has been confirmed.
   */
  const gate = useMemo(() => {
    if (!terms) return null;
    const unreviewed = new Set(remote.data?.unreviewedFields ?? []);
    const confirmed = new Set(
      (Object.keys(terms) as TermField[]).filter(
        (field) => !unreviewed.has(field),
      ),
    );
    return mintGate(terms, issuer?.verified ?? false, {
      confirmed,
      now: DEMO_NOW,
    });
  }, [terms, issuer?.verified, remote.data?.unreviewedFields]);

  if (remote.isPending) return <ReviewLoading />;
  if (remote.isError) {
    return <ReviewUnavailable message={(remote.error as Error).message} />;
  }
  if (!note || !terms || !gate) return null;

  /**
   * Corrections go to the service, which re-validates. A change that breaks
   * the arithmetic is caught there rather than only in the browser.
   */
  const setField = (field: TermField, raw: string, kind: EditorKind) => {
    const value = kind === "number" || kind === "percent" ? Number(raw) : raw;
    review.mutate({ terms: { [field]: value }, reviewedBy: address ?? null });
  };

  const confirmAsExtracted = (field: TermField) =>
    review.mutate({ confirmed: [field], reviewedBy: address ?? null });

  /**
   * Signs the mint with the connected wallet.
   *
   * `NoteFactory` checks the registry against whoever signed, so this has to be
   * the issuer's own transaction — routing it through a server would put an
   * unregistered address in the middle and defeat the gate entirely.
   *
   * The service is told only after the chain confirms. Recording on broadcast
   * would index a note that could still revert.
   */
  const handleMint = async () => {
    setMintError(null);
    try {
      const result = await minting.mint({
        terms,
        name: note.name,
        symbol: note.symbol,
        issuer: address!,
        currency,
        documentHash: note.document.hash,
        supplyTokens: SUPPLY_TOKENS,
      });

      // Only now that the chain has confirmed, and the factory has told us
      // which contracts it created.
      await recordMint.mutateAsync({
        ...result,
        issuer: address!,
        chainId: CHAIN_ID,
        name: note.name,
        symbol: note.symbol,
      });

      /*
       * The offering is a second decision and a second pair of transactions.
       * It runs after the mint has confirmed because there is nothing to sell
       * until the note exists, and it is allowed to fail on its own: a note
       * that minted but whose sale did not open is recoverable from its own
       * page, whereas throwing here would strand a minted note behind an
       * error about a pool.
       */
      const pct = Number(salePct);
      if (pct > 0) {
        try {
          const poolTokens = parseUnits(
            ((SUPPLY_TOKENS * pct) / 100).toFixed(18),
            18,
          );
          const proceeds = Number(saleProceeds);
          const priceOverride =
            proceeds > 0 && poolTokens > 0n
              ? (parseUnits(
                  proceeds.toFixed(CURRENCY_DECIMALS[currency]),
                  CURRENCY_DECIMALS[currency],
                ) *
                  10n ** 18n) /
                poolTokens
              : 0n;

          await openOffer.run(result.note, poolTokens, priceOverride);
        } catch (cause) {
          setMintError(
            `The note was minted, but the sale did not open: ${
              (cause as Error).message
            } You can open it from the note's own page.`,
          );
        }
      }

      router.push(`/note/${noteId}`);
    } catch (cause) {
      setMintError((cause as Error).message);
    }
  };

  const schedule = terms.schedule.value;
  const scheduleLow =
    terms.schedule.confidence < LOW_CONFIDENCE_THRESHOLD &&
    !terms.schedule.editedByHuman;

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col">
      <Stepper current={1} />
      <PaneToggle pane={pane} onChange={setPane} />

      <div className="grid min-h-0 flex-1 lg:grid-cols-2">
        <DocumentPane
          document={note.document}
          terms={terms}
          activeField={activeField}
          onFieldHover={setActiveField}
          className={cn(pane === "document" ? "flex" : "hidden", "lg:flex")}
        />

        <div
          className={cn(
            "min-h-0 flex-col",
            pane === "terms" ? "flex" : "hidden",
            "lg:flex",
          )}
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-5 sm:py-6">
            <header className="mb-4">
              <h1 className="text-xl font-semibold">Extracted terms</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Check each value against the highlighted clause. Hovering either
                side links the two.
              </p>
            </header>

            <ReviewSummary
              unreviewed={gate.unreviewedFields.length}
              blocking={gate.validation.issues.filter(
                (issue) => issue.severity === "blocking",
              ).length}
            />

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {EDITORS.map(({ field, kind, options }) => {
                const extracted = terms[field];
                const confirmed =
                  extracted.confidence >= LOW_CONFIDENCE_THRESHOLD ||
                  Boolean(extracted.editedByHuman);
                return (
                  <TermCard
                    key={field}
                    field={field}
                    kind={kind}
                    options={options}
                    value={String(extracted.value)}
                    confidence={extracted.confidence}
                    confirmed={confirmed}
                    note={extracted.note}
                    active={activeField === field}
                    onHover={setActiveField}
                    onChange={(next) => setField(field, next, kind)}
                    onConfirm={() => confirmAsExtracted(field)}
                  />
                );
              })}
            </div>

            <section className="mt-6">
              <div className="mb-2 flex items-center justify-between">
                <FieldLabel>Repayment schedule</FieldLabel>
                {scheduleLow ? (
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => confirmAsExtracted("schedule")}
                    className="border-review/40 text-review hover:bg-review/10 hover:text-review"
                  >
                    Confirm schedule
                  </Button>
                ) : null}
              </div>
              <div
                className={cn(
                  "overflow-hidden rounded-lg border",
                  scheduleLow ? "border-review" : "border-border",
                )}
              >
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>Due</TableHead>
                      <TableHead className="text-right">Principal</TableHead>
                      <TableHead className="text-right">Interest</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
              {schedule.map((period: PaymentPeriod) => (
                      <TableRow key={period.index}>
                        <TableCell className="tnum font-mono text-xs text-muted-foreground">
                          {period.index}
                        </TableCell>
                        <TableCell className="tnum font-mono text-xs">
                          {shortDate(period.dueDate)}
                        </TableCell>
                        <TableCell className="tnum text-right font-mono text-xs">
                          {period.principal > 0
                            ? money(period.principal)
                            : "—"}
                        </TableCell>
                        <TableCell className="tnum text-right font-mono text-xs">
                          {money(period.interest)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  {/*
                    Totals, because the whole principal sits in one row of a
                    schedule that can run to dozens. A reviewer checking that
                    the terms hang together should not have to scroll for it,
                    and these two figures are exactly what the validator
                    reconciles against the stated principal and rate.
                  */}
                  <TableFooter>
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={2}>
                        <FieldLabel>
                          {schedule.length} payment
                          {schedule.length === 1 ? "" : "s"}
                        </FieldLabel>
                      </TableCell>
                      <TableCell className="tnum text-right font-mono text-xs">
                        {money(
                          schedule.reduce((sum, p) => sum + p.principal, 0),
                        )}
                      </TableCell>
                      <TableCell className="tnum text-right font-mono text-xs">
                        {money(
                          schedule.reduce((sum, p) => sum + p.interest, 0),
                        )}
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            </section>
          </div>

          <SettlementCurrency value={currency} onChange={setCurrency} />
          <OfferingAtIssue
            currency={currency}
            pct={salePct}
            proceeds={saleProceeds}
            onPct={setSalePct}
            onProceeds={setSaleProceeds}
          />

          <MintFooter
            gate={gate}
            minting={
              minting.isSigning ||
              minting.isConfirming ||
              openOffer.isApproving ||
              openOffer.isFunding
            }
            signing={minting.isSigning}
            error={mintError}
            onMint={handleMint}
            issuerVerified={issuer?.verified ?? false}
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * How much of the loan to place for sale, decided at issuance.
 *
 * The factory mints the whole supply to the issuer, so without this a note is
 * born entirely in one pair of hands and no investor can ever reach it. The
 * issuer says what share to offer and what they want for it; the price per
 * token is the quotient, which is the way round an issuer actually thinks —
 * "sell a quarter of this and raise 245,000", not "quote 0.98 per token".
 *
 * Leaving the proceeds blank sells at par, where one token is a claim on one
 * unit of principal and the raise equals the share being sold.
 */
function OfferingAtIssue({
  currency,
  pct,
  proceeds,
  onPct,
  onProceeds,
}: {
  currency: Currency;
  pct: string;
  proceeds: string;
  onPct: (next: string) => void;
  onProceeds: (next: string) => void;
}) {
  const share = Number(pct);
  const valid = Number.isFinite(share) && share > 0 && share <= 100;
  const poolTokens = valid ? (SUPPLY_TOKENS * share) / 100 : 0;

  const wanted = Number(proceeds);
  const perToken =
    poolTokens > 0 && Number.isFinite(wanted) && wanted > 0
      ? wanted / poolTokens
      : null;

  return (
    <div className="border-t border-border bg-card px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <FieldLabel>Offer for sale</FieldLabel>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Placed on the sale desk once the note is minted. Leave empty to keep
            the whole issue.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Input
              value={pct}
              onChange={(event) => onPct(event.target.value)}
              placeholder="0"
              inputMode="decimal"
              aria-label="Percent of supply to offer"
              className="tnum w-24 pr-7 text-sm"
            />
            <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-muted-foreground">
              %
            </span>
          </div>
          <Input
            value={proceeds}
            onChange={(event) => onProceeds(event.target.value)}
            placeholder="At par"
            inputMode="decimal"
            aria-label={`Amount to receive in ${currency}`}
            disabled={!valid}
            className="tnum w-32 text-sm"
          />
        </div>
      </div>

      {valid ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {poolTokens.toLocaleString("en-US", { maximumFractionDigits: 2 })} of{" "}
          {SUPPLY_TOKENS.toLocaleString("en-US")} tokens
          {perToken !== null ? (
            <>
              {" "}
              at{" "}
              <span className="tnum text-foreground">
                {perToken.toLocaleString("en-US", {
                  maximumFractionDigits: 6,
                })}{" "}
                {currency}
              </span>{" "}
              each.
            </>
          ) : (
            <> at par — one token per unit of principal.</>
          )}{" "}
          Unsold tokens can be taken back at any time.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Settlement currency, chosen rather than extracted.
 *
 * Sits outside the term cards on purpose. Nothing in a loan agreement names a
 * stablecoin — the paper says "$" — so presenting this as something read from
 * the document would misrepresent where the value came from.
 */
function SettlementCurrency({
  value,
  onChange,
}: {
  value: Currency;
  onChange: (next: Currency) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border bg-card px-4 py-3 sm:px-5">
      <div>
        <FieldLabel>Settlement currency</FieldLabel>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Chosen at issuance — not read from the document.
        </p>
      </div>
      <Select value={value} onValueChange={(next) => onChange(next as Currency)}>
        <SelectTrigger size="sm" className="w-32 font-mono">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CURRENCIES.map((option) => (
            <SelectItem key={option} value={option} className="font-mono">
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Mobile-only switch between the source document and the extracted terms. */
function PaneToggle({
  pane,
  onChange,
}: {
  pane: "document" | "terms";
  onChange: (next: "document" | "terms") => void;
}) {
  return (
    <div className="flex border-b border-border bg-card lg:hidden">
      {(["document", "terms"] as const).map((option) => (
        <button
          key={option}
          onClick={() => onChange(option)}
          className={cn(
            "flex-1 px-4 py-2.5 font-mono text-xs uppercase tracking-[0.05em] transition-colors",
            pane === option
              ? "border-b-2 border-verified text-foreground"
              : "text-muted-foreground",
          )}
        >
          {option === "document" ? "Document" : "Extracted terms"}
        </button>
      ))}
    </div>
  );
}

function ReviewLoading() {
  return (
    <div className="flex h-[calc(100dvh-3.5rem)] items-center justify-center">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading extraction…
      </p>
    </div>
  );
}

function ReviewUnavailable({ message }: { message: string }) {
  return (
    <div className="mx-auto max-w-[600px] px-6 py-16 text-center">
      <h1 className="text-xl font-semibold">Extraction unavailable</h1>
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

function Stepper({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-2 overflow-x-auto border-b border-border bg-card px-4 py-2.5 sm:gap-3 sm:px-6 sm:py-3">
      {STEPS.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={step} className="flex shrink-0 items-center gap-2 sm:gap-3">
            <span
              className={cn(
                "flex size-5 items-center justify-center rounded-full font-mono text-[10px] font-semibold",
                done && "bg-verified text-background",
                active && "bg-primary text-primary-foreground",
                !done && !active && "bg-muted text-muted-foreground",
              )}
            >
              {done ? <Check className="size-3" /> : index + 1}
            </span>
            <span
              className={cn(
                "font-mono text-xs uppercase tracking-[0.05em]",
                // Only the current step is named on a narrow screen; the rest
                // are numbered dots, which is enough to show progress.
                active ? "text-foreground" : "hidden text-muted-foreground sm:inline",
              )}
            >
              {step}
            </span>
            {index < STEPS.length - 1 ? (
              <span className="h-px w-4 bg-border sm:w-12 lg:w-16" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function ReviewSummary({
  unreviewed,
  blocking,
}: {
  unreviewed: number;
  blocking: number;
}) {
  if (blocking > 0) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-impaired/40 bg-impaired/10 px-3 py-2.5 text-sm text-impaired">
        <CircleAlert className="mt-0.5 size-4 shrink-0" />
        <span>
          The validator found {blocking}{" "}
          {blocking === 1 ? "inconsistency" : "inconsistencies"} in these terms.
          They cannot be minted.
        </span>
      </div>
    );
  }
  if (unreviewed > 0) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-review/40 bg-review/10 px-3 py-2.5 text-sm text-review">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
        <span>
          {unreviewed} {unreviewed === 1 ? "field requires" : "fields require"}{" "}
          human verification.
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 rounded-lg border border-verified/40 bg-verified/10 px-3 py-2.5 text-sm text-verified">
      <Check className="mt-0.5 size-4 shrink-0" />
      <span>All fields verified and internally consistent.</span>
    </div>
  );
}

function MintFooter({
  gate,
  minting,
  signing,
  error,
  onMint,
  issuerVerified,
}: {
  gate: NonNullable<ReturnType<typeof mintGate>>;
  minting: boolean;
  signing: boolean;
  error: string | null;
  onMint: () => void;
  issuerVerified: boolean;
}) {
  return (
    <div className="border-t border-border bg-card px-4 py-3 sm:px-5 sm:py-4">
      {gate.canMint ? null : (
        <ul className="mb-3 space-y-1.5">
          {gate.blockers.map((blocker, index) => (
            <li
              key={index}
              className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"
            >
              {!issuerVerified && index === 0 ? (
                <ShieldOff className="mt-0.5 size-3.5 shrink-0 text-impaired" />
              ) : (
                <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-review" />
              )}
              <span>{blocker}</span>
            </li>
          ))}
        </ul>
      )}

      {error ? (
        <p className="mb-2 flex items-start gap-1.5 text-xs text-impaired">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </p>
      ) : null}

      <Button
        size="lg"
        onClick={onMint}
        disabled={!gate.canMint || minting}
        className="w-full"
      >
        {signing ? (
          <>
            <Loader2 className="animate-spin" /> Confirm in wallet…
          </>
        ) : minting ? (
          <>
            <Loader2 className="animate-spin" /> Waiting for X Layer…
          </>
        ) : (
          "Approve & mint RWA note"
        )}
      </Button>
    </div>
  );
}
