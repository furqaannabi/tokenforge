"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  Check,
  FileText,
  Loader2,
  ShieldAlert,
} from "lucide-react";
import { FieldLabel, HexValue, StatTile, Stamp, StatusBadge } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useNotes } from "@/lib/notes";
import { useWallet } from "@/lib/wallet";
import { DEMO_NOW } from "@/lib/clock";
import { couponTotals, impairment, scheduleWithStatus } from "@/lib/schedule";
import { money, monthYear, percent, shortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PeriodStatus } from "@/lib/schedule";

export function NoteScreen({ noteId }: { noteId: string }) {
  const { getNote, settlePeriod } = useNotes();
  const { issuer } = useWallet();
  const [settling, setSettling] = useState<number | null>(null);

  const note = getNote(noteId);
  if (!note) return null;

  if (note.status === "review" || note.status === "draft") {
    return <NotMinted noteId={noteId} />;
  }

  const schedule = scheduleWithStatus(note, DEMO_NOW);
  const totals = couponTotals(note);
  const { impaired } = impairment(note, DEMO_NOW);
  const next = schedule.find(
    (period) => period.status === "due" || period.status === "overdue",
  );
  const isIssuer = issuer?.address === note.issuer.address;
  const currency = note.terms.currency.value;

  const handleSettle = (periodIndex: number) => {
    setSettling(periodIndex);
    // Stands in for the issuer's USDG deposit into RepaymentVault.
    setTimeout(() => {
      settlePeriod(noteId, periodIndex);
      setSettling(null);
    }, 900);
  };

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-8">
      <Link
        href="/"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> All notes
      </Link>

      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">{note.name}</h1>
          <Stamp tone="neutral">{note.symbol}</Stamp>
          <StatusBadge status={impaired ? "impaired" : note.status} />
        </div>
        <p className="mt-1.5 flex items-center gap-2 text-sm text-muted-foreground">
          Issued by {note.issuer.name}
          {note.issuer.verified ? (
            <BadgeCheck className="size-4 text-verified" />
          ) : null}
          · {note.issuer.jurisdiction}
        </p>
      </header>

      {impaired ? (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-impaired/40 bg-impaired/10 p-4">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-impaired" />
          <div>
            <p className="font-semibold text-impaired">
              Impaired — payment overdue beyond the grace period
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Transfers are blocked by the note&apos;s allowlist hook until the
              outstanding coupon is settled.
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Principal"
          value={money(note.terms.principal.value)}
          sub={`Settled in ${currency}`}
        />
        <StatTile
          label="Coupon rate"
          value={percent(note.terms.interestRatePct.value)}
          tone="verified"
          sub={`${note.terms.dayCount.value} · ${note.terms.paymentFrequency.value}`}
        />
        <StatTile
          label="Maturity"
          value={monthYear(note.terms.maturityDate.value)}
          sub={shortDate(note.terms.maturityDate.value)}
        />
        <StatTile
          label="Next coupon"
          value={next ? money(next.interest) : "—"}
          sub={next ? shortDate(next.dueDate) : "Fully repaid"}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card className="py-0">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <CardTitle>Repayment schedule</CardTitle>
            <span className="tnum font-mono text-xs text-muted-foreground">
              {money(totals.settled)} of {money(totals.total)} paid
            </span>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-12">#</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="text-right">Principal</TableHead>
                <TableHead className="text-right">Interest</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {schedule.map((period) => (
                <TableRow
                  key={period.index}
                  className={cn(
                    period.status === "overdue" && "bg-impaired/5",
                    period.status === "due" && "bg-muted/40",
                  )}
                >
                  <TableCell className="tnum font-mono text-xs text-muted-foreground">
                    {period.index}
                  </TableCell>
                  <TableCell className="tnum font-mono text-xs">
                    {shortDate(period.dueDate)}
                  </TableCell>
                  <TableCell className="tnum text-right font-mono text-xs">
                    {period.principal > 0 ? money(period.principal) : "—"}
                  </TableCell>
                  <TableCell className="tnum text-right font-mono text-xs">
                    {money(period.interest)}
                  </TableCell>
                  <TableCell className="text-right">
                    <PeriodStamp status={period.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        <div className="space-y-6">
          {isIssuer && next ? (
            <Card>
              <CardHeader>
                <CardTitle>Issuer actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-baseline justify-between">
                  <FieldLabel>Coupon {next.index} due</FieldLabel>
                  <span className="tnum font-mono text-sm">
                    {money(next.interest + next.principal, currency)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Deposits into <code className="font-mono">RepaymentVault</code>
                  , which distributes pro-rata to holders on claim.
                </p>
                <Button
                  className="w-full"
                  onClick={() => handleSettle(next.index)}
                  disabled={settling !== null}
                >
                  {settling !== null ? (
                    <>
                      <Loader2 className="animate-spin" /> Depositing…
                    </>
                  ) : (
                    `Deposit coupon in ${currency}`
                  )}
                </Button>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Transparency</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <HexValue label="Source document hash" value={note.document.hash} />
              {note.address ? (
                <HexValue label="Note contract" value={note.address} />
              ) : null}
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <FileText className="size-3.5 shrink-0" />
                {note.document.filename}
              </p>
              <p className="border-t border-border pt-3 text-xs text-muted-foreground">
                The hash binds this token to the exact file it was minted from.
                Any edit to the document produces a different hash.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

const PERIOD_LABEL: Record<PeriodStatus, string> = {
  paid: "Paid",
  overdue: "Overdue",
  due: "Due",
  scheduled: "Scheduled",
};

function PeriodStamp({ status }: { status: PeriodStatus }) {
  if (status === "paid") {
    return (
      <Stamp tone="verified">
        <Check /> Paid
      </Stamp>
    );
  }
  return (
    <Stamp
      tone={
        status === "overdue" ? "impaired" : status === "due" ? "review" : "neutral"
      }
    >
      {PERIOD_LABEL[status]}
    </Stamp>
  );
}

function NotMinted({ noteId }: { noteId: string }) {
  return (
    <div className="mx-auto max-w-[600px] px-6 py-16 text-center">
      <h1 className="text-xl font-semibold">This note has not been minted</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Its terms are still in review. Nothing exists on-chain until the
        extracted terms pass validation and an authorized representative
        approves them.
      </p>
      <Button asChild className="mt-6">
        <Link href={`/review/${noteId}`}>Go to review</Link>
      </Button>
    </div>
  );
}
