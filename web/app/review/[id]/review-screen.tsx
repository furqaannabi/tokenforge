"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { isAddress, parseUnits } from "viem";
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
  useCheckProvenance,
  useExtraction,
  useRequestMint,
  useRecordMintedNote,
  useReviewExtraction,
} from "@/lib/queries";
import type { ApiProvenance } from "@/lib/api";
import { useMintNote } from "@/lib/mint";
import { useOpenOfferFor } from "@/lib/sale";
import { useIsMintApproved } from "@/lib/registry";
import { SUPPLY_TOKENS } from "@/lib/issuance";
import { CHAIN_ID } from "@/lib/contracts";
import { extractionToNote } from "@/lib/adapt";
import { useWallet } from "@/lib/wallet";
import { DEMO_NOW } from "@/lib/clock";
import { mintGate, LOW_CONFIDENCE_THRESHOLD } from "@tokenforge/core";
import { money, shortDate, confidencePct } from "@/lib/format";
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
  const requestMint = useRequestMint(noteId);
  const recordMint = useRecordMintedNote(noteId);
  // Below lg the two panes cannot sit side by side, so one shows at a time.
  const [pane, setPane] = useState<"document" | "terms">("terms");
  // Issuance decisions, not extractions: no document states either of them.
  const [currency, setCurrency] = useState<Currency>("USDG");
  // Share of the supply to place for sale at issuance. There is no price to
  // choose: the desk quotes par from the note's own principal.
  const [salePct, setSalePct] = useState("");
  // The wallet that will repay. The document names the borrower; only the
  // issuer can say which address that company controls.
  const [borrower, setBorrower] = useState("");
  // Dismissal of the schedule warning, which the service does not track.
  const [scheduleConfirmed, setScheduleConfirmed] = useState(false);

  const remote = useExtraction(noteId);
  const review = useReviewExtraction(noteId);

  // The admin clears an exact set of parameters. Until they have, and until
  // the chain says so, there is nothing to sign.
  const mintRequest = remote.data?.mintRequest ?? null;
  const approval = useIsMintApproved(
    mintRequest?.issuer,
    mintRequest?.mintHash,
  );

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
  const unreviewed = useMemo(
    () => new Set<string>(remote.data?.unreviewedFields ?? []),
    [remote.data?.unreviewedFields],
  );

  const gate = useMemo(() => {
    if (!terms) return null;
    const confirmed = new Set(
      (Object.keys(terms) as TermField[]).filter(
        (field) => !unreviewed.has(field),
      ),
    );
    return mintGate(terms, issuer?.verified ?? false, {
      confirmed,
      now: DEMO_NOW,
      provenance: remote.data?.provenance ?? undefined,
    });
  }, [terms, issuer?.verified, unreviewed, remote.data?.provenance]);

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
  /** Asks the admin to clear this mint. Nothing reaches the chain yet. */
  const handleRequest = async () => {
    setMintError(null);
    try {
      await requestMint.mutateAsync({
        issuer: address!,
        borrower: borrower.trim() as `0x${string}`,
        currency,
        supplyTokens: SUPPLY_TOKENS,
      });

      /*
       * Nothing more happens here until an admin acts, and the review screen
       * gives no sign of that — leaving the issuer staring at a submitted form
       * with no idea whether to wait or do something. The portfolio lists what
       * is waiting, so that is where submitting leads.
       */
      router.push("/app?view=mine");
    } catch (cause) {
      setMintError((cause as Error).message);
    }
  };

  const handleMint = async () => {
    setMintError(null);
    if (!mintRequest) return;
    try {
      const result = await minting.mintApproved(mintRequest);

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
          await openOffer.run(result.note, poolTokens);
        } catch (cause) {
          setMintError(
            `The note was minted, but the sale did not open: ${
              (cause as Error).message
            } You can open it from the note's own page.`,
          );
        }
      }

      // The portfolio, not the note: a freshly minted note is still Pending
      // until the borrower accepts, and the list is where the next thing to do
      // is visible.
      router.push("/app?view=mine");
    } catch (cause) {
      setMintError((cause as Error).message);
    }
  };

  const schedule = terms.schedule.value;
  /*
   * The schedule is confirmed here rather than on the service.
   *
   * `unreviewedFields` only ever lists fields that gate a mint, and the
   * schedule is not one of them — it has no editor, so a blocking flag on it
   * could never be cleared. Confirming it therefore has nothing to record
   * server-side, and without somewhere to put the answer the button sat there
   * doing nothing every time it was pressed. Local is the honest scope: it
   * dismisses a warning, and dismissing it claims nothing the gate relies on.
   */
  const scheduleLow =
    terms.schedule.confidence < LOW_CONFIDENCE_THRESHOLD &&
    !terms.schedule.editedByHuman &&
    !scheduleConfirmed;

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
          <div className="@container min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-5 sm:py-6">
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

            <div className="mt-4 grid items-stretch gap-3 @2xl:grid-cols-2">
              {EDITORS.map(({ field, kind, options }) => {
                const extracted = terms[field];
                /*
                 * The service owns this, not the confidence score.
                 *
                 * Deriving it from confidence alone meant "Confirm as
                 * extracted" appeared to do nothing: the request succeeded and
                 * the mint gate opened, but the card kept its warning and its
                 * button, because confirming deliberately does not raise
                 * confidence — nothing about the value changed. Anything absent
                 * from `unreviewedFields` has been vouched for, which is the
                 * same rule the gate above applies.
                 */
                const confirmed = !unreviewed.has(field);
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
                    onClick={() => setScheduleConfirmed(true)}
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

            {/*
              Issuance decisions scroll with the terms rather than stacking
              under them. Pinned to the bottom, these four blocks plus the
              action bar took roughly 420px of a 900px viewport and squeezed
              the terms into a sliver — and on a shorter screen they collided.
              Only the action bar is chrome; the rest is form.
            */}
            <div className="mt-6 space-y-px overflow-hidden rounded-lg border border-border">
              {/*
                The wallet comes first, because the check below cannot answer
                its borrower question without one. Asking for provenance above
                the field that feeds it left the reviewer reading "enter the
                borrower wallet below" next to a button they could not press.
              */}
              <BorrowerWallet value={borrower} onChange={setBorrower} />
              <ProvenanceCheck
                extractionId={noteId}
                issuerName={issuer?.name}
                issuerJurisdiction={issuer?.jurisdiction}
                result={remote.data?.provenance ?? null}
                borrowerAddress={borrower}
              />
              <SettlementCurrency value={currency} onChange={setCurrency} />
              <OfferingAtIssue
                currency={currency}
                principal={terms.principal.value}
                pct={salePct}
                onPct={setSalePct}
              />
            </div>
          </div>


          <MintFooter
            gate={gate}
            borrowerReady={isAddress(borrower.trim(), { strict: false })}
            requested={Boolean(mintRequest)}
            approved={approval.approved}
            requesting={requestMint.isPending}
            onRequest={handleRequest}
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
 * Whose document is this, and have we seen it before?
 *
 * The document hash already stops the identical file being tokenized twice —
 * `NoteFactory` refuses a hash it has claimed. Neither that nor registry
 * membership catches the two things this asks: an agreement re-exported or
 * rescanned is a different file describing the same loan, and a registered
 * issuer uploading somebody else's agreement is registered all the same.
 *
 * It is a model comparing companies and figures, so it informs rather than
 * decides. The reason is always shown, because a reviewer who knows the group
 * structure may reasonably overrule it.
 */
function ProvenanceCheck({
  extractionId,
  issuerName,
  issuerJurisdiction,
  borrowerAddress,
  result,
}: {
  extractionId: string;
  issuerName?: string;
  issuerJurisdiction?: string;
  /** The wallet that will repay, once the issuer has named one. */
  borrowerAddress?: string;
  result: ApiProvenance | null;
}) {
  const check = useCheckProvenance(extractionId);

  /*
   * One of the three verdicts is about the borrower — does the wallet named to
   * repay belong to the company the document says owes the money. There is
   * nothing to compare until a wallet has been given, so running without one
   * spends a model call to return two answers out of three.
   */
  const hasBorrower = isAddress(borrowerAddress?.trim() ?? "", {
    strict: false,
  });

  return (
    <div className="bg-card px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <FieldLabel>Provenance</FieldLabel>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Runs on its own after extraction: whether this document is yours,
            whether the borrower wallet matches it, and whether the same
            agreement has been tokenized before under another file.
          </p>
          {!hasBorrower ? (
            <p className="mt-1 text-xs text-review">
              Enter the borrower wallet above to run this — the borrower
              verdict has nothing to compare against without one.
            </p>
          ) : null}
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={!issuerName || !hasBorrower || check.isPending}
          onClick={() =>
            issuerName &&
            hasBorrower &&
            check.mutate({
              issuerName,
              issuerJurisdiction,
              borrowerAddress: borrowerAddress!.trim(),
            })
          }
        >
          {check.isPending ? (
            <>
              <Loader2 className="animate-spin" /> Checking…
            </>
          ) : (
            "Re-check"
          )}
        </Button>
      </div>

      {check.isError ? (
        <p className="mt-2 text-xs text-impaired">
          {(check.error as Error).message}
        </p>
      ) : null}

      {result ? (
        <div className="mt-3 space-y-2">
          <Verdict
            ok={result.ownership.belongsToIssuer}
            label={
              result.ownership.belongsToIssuer
                ? "You are the lender on this agreement"
                : `Lender is ${result.ownership.documentLender}`
            }
            confidence={result.ownership.confidence}
            reason={result.ownership.reason}
          />
          {result.borrower ? (
            <Verdict
              ok={result.borrower.matchesDocument}
              label={
                result.borrower.matchesDocument
                  ? "Borrower wallet matches the agreement"
                  : `Document names ${result.borrower.documentBorrower} as borrower`
              }
              confidence={result.borrower.confidence}
              reason={result.borrower.reason}
            />
          ) : null}
          <Verdict
            ok={!result.duplicate.isDuplicate}
            label={
              result.duplicate.isDuplicate
                ? "Already extracted under another file"
                : "No earlier copy of this agreement"
            }
            confidence={result.duplicate.confidence}
            reason={result.duplicate.reason}
          />
        </div>
      ) : null}
    </div>
  );
}

function Verdict({
  ok,
  label,
  confidence,
  reason,
}: {
  ok: boolean;
  label: string;
  confidence: number;
  reason: string;
}) {
  return (
    <div className="flex items-start gap-2 text-xs">
      {ok ? (
        <Check className="mt-0.5 size-3.5 shrink-0 text-verified" />
      ) : (
        <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-impaired" />
      )}
      <span className={ok ? "text-muted-foreground" : "text-foreground"}>
        <span className="font-medium">{label}</span>
        <span className="tnum ml-1.5 text-muted-foreground">
          {confidencePct(confidence)}
        </span>
        <span className="mt-0.5 block text-muted-foreground">{reason}</span>
      </span>
    </div>
  );
}

/**
 * The wallet that will repay.
 *
 * Three parties, and until now two of them were the same address. The issuer
 * originated this loan and is selling it to get their capital back early; the
 * borrower owes the money; the holders own the repayments. Naming the borrower
 * is what separates the first two — without it the originator appeared to owe a
 * debt to the people they had just sold it to.
 *
 * The document names a borrowing company. Which address that company controls
 * is not in the document, and the factory rejects one the registry has not
 * admitted.
 */
function BorrowerWallet({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const trimmed = value.trim();
  const malformed = trimmed.length > 0 && !isAddress(trimmed, { strict: false });

  return (
    <div className="bg-card px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <FieldLabel>Borrower wallet</FieldLabel>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Who repays. The note stays pending until this wallet accepts the
            terms.
          </p>
        </div>
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="0x…"
          aria-label="Borrower wallet address"
          className="w-full font-mono text-sm sm:w-[24rem]"
        />
      </div>
      {malformed ? (
        <p className="mt-2 text-xs text-impaired">
          That is not a valid address.
        </p>
      ) : null}
    </div>
  );
}

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
  principal,
  pct,
  onPct,
}: {
  currency: Currency;
  principal: number;
  pct: string;
  onPct: (next: string) => void;
}) {
  const share = Number(pct);
  const valid = Number.isFinite(share) && share > 0 && share <= 100;
  const poolTokens = valid ? (SUPPLY_TOKENS * share) / 100 : 0;

  // Par, the same arithmetic the desk does on-chain: a token is a claim on one
  // unit of principal, so the price and the proceeds both follow from the size.
  const perToken = principal / SUPPLY_TOKENS;
  const proceeds = poolTokens * perToken;

  return (
    <div className="bg-card px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <FieldLabel>Offer for sale</FieldLabel>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Placed on the sale desk once the note is minted. Leave empty to keep
            the whole issue.
          </p>
        </div>
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
      </div>

      {valid ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {poolTokens.toLocaleString("en-US", { maximumFractionDigits: 2 })} of{" "}
          {SUPPLY_TOKENS.toLocaleString("en-US")} tokens at{" "}
          <span className="tnum text-foreground">
            {perToken.toLocaleString("en-US", { maximumFractionDigits: 2 })}{" "}
            {currency}
          </span>{" "}
          each, raising{" "}
          <span className="tnum text-foreground">
            {proceeds.toLocaleString("en-US", { maximumFractionDigits: 2 })}{" "}
            {currency}
          </span>{" "}
          if fully taken. The price is par, computed by the desk — there is
          nothing to set. Unsold tokens can be taken back at any time.
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
    <div className="flex items-center justify-between gap-3 bg-card px-4 py-3 sm:px-5">
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
  borrowerReady,
  requested,
  approved,
  requesting,
  onRequest,
  minting,
  signing,
  error,
  onMint,
  issuerVerified,
}: {
  gate: NonNullable<ReturnType<typeof mintGate>>;
  borrowerReady: boolean;
  /** The issuer has submitted these parameters for a decision. */
  requested: boolean;
  /** The chain says the admin cleared them. */
  approved: boolean;
  requesting: boolean;
  onRequest: () => void;
  minting: boolean;
  signing: boolean;
  error: string | null;
  onMint: () => void;
  issuerVerified: boolean;
}) {
  const reasons = [
    ...gate.blockers,
    ...(borrowerReady
      ? []
      : [
          "Name the borrower's wallet above. The factory rejects a mint without one, and the note would have nobody to accept it.",
        ]),
  ];
  return (
    <div className="border-t border-border bg-card px-4 py-3 sm:px-5 sm:py-4">
      {/*
        Every reason at once, including the borrower.
        
        The borrower hint used to appear only once everything else passed, so
        while a field still needed review the button sat disabled with nothing
        saying a wallet was also required — which reads as permanently broken
        rather than as a step not yet done.
      */}
      {/*
        Capped, and scrolled if it needs to be. Four blocking reasons written
        out in full grew this bar to a third of the column and pushed the terms
        it is meant to serve off the screen — an action bar that eats the work
        surface is worse than one that makes you scroll two lines.
      */}
      {reasons.length > 0 ? (
        <ul className="mb-3 max-h-24 space-y-1.5 overflow-y-auto pr-1">
          {reasons.map((reason, index) => (
            <li
              key={index}
              className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"
            >
              {!issuerVerified && index === 0 ? (
                <ShieldOff className="mt-0.5 size-3.5 shrink-0 text-impaired" />
              ) : (
                <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-review" />
              )}
              <span>{reason}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <p className="mb-2 flex items-start gap-1.5 text-xs text-impaired">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </p>
      ) : null}

      {requested && !approved ? (
        <p className="mb-3 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
          <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-review" />
          <span>
            Submitted for approval. The registry admin clears these exact
            parameters on-chain; this becomes signable the moment they do.
          </span>
        </p>
      ) : null}

      {approved ? (
        <Button
          size="lg"
          onClick={onMint}
          disabled={minting}
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
            "Mint RWA note"
          )}
        </Button>
      ) : (
        <Button
          size="lg"
          onClick={onRequest}
          disabled={reasons.length > 0 || requesting}
          className="w-full"
        >
          {requesting ? (
            <>
              <Loader2 className="animate-spin" /> Submitting…
            </>
          ) : requested ? (
            "Resubmit for approval"
          ) : (
            "Submit for approval"
          )}
        </Button>
      )}
    </div>
  );
}
