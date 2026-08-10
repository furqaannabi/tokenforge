"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, CircleAlert, Loader2, ShieldOff, TriangleAlert } from "lucide-react";
import { DocumentPane } from "@/components/document-pane";
import { TermCard, type EditorKind } from "@/components/term-card";
import { FieldLabel } from "@/components/primitives";
import { Button } from "@/components/ui/button";
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
  const recordMint = useRecordMintedNote(noteId);
  // Below lg the two panes cannot sit side by side, so one shows at a time.
  const [pane, setPane] = useState<"document" | "terms">("terms");
  // An issuance decision, not an extraction: no document states it.
  const [currency, setCurrency] = useState<Currency>("USDG");

  const remote = useExtraction(noteId);
  const review = useReviewExtraction(noteId);

  const note = useMemo(
    () => (remote.data ? extractionToNote(remote.data, address) : undefined),
    [remote.data, address],
  );
  const terms = note?.terms;

  const gate = useMemo(
    () => (terms ? mintGate(terms, issuer?.verified ?? false, { now: DEMO_NOW }) : null),
    [terms, issuer?.verified],
  );

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
                </Table>
              </div>
            </section>
          </div>

          <SettlementCurrency value={currency} onChange={setCurrency} />

          <MintFooter
            gate={gate}
            minting={minting.isSigning || minting.isConfirming}
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
