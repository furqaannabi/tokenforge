"use client";

import Link from "next/link";
import { formatUnits } from "viem";
import { Stamp } from "@/components/primitives";
import { NOTE_STATUS, statusTone, useNotesMarket } from "@/lib/portfolio";
import { money, percent, monthYear } from "@/lib/format";
import {
  Card,
  CardContent,
  CardDescription,
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

/**
 * Every note that has been issued, open to anyone.
 *
 * Deliberately readable without a wallet. The point of putting private credit
 * on a chain is that its terms and its repayment record stop being private to
 * the lender, so a page that demanded a connection before showing anything
 * would give that back.
 */
export function AllNotesView() {
  const { rows, isPending, isError } = useNotesMarket();

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Issued notes
        </h1>
        <p className="mt-1 text-muted-foreground">
          Every note minted through TokenForge, with the terms extracted from
          its signed agreement and its repayment record read from the chain.
          Anything showing a quantity under <em>For sale</em> can be bought now.
        </p>
      </header>

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Note</TableHead>
              <TableHead className="text-right">Outstanding</TableHead>
              <TableHead className="text-right">Rate</TableHead>
              <TableHead>Maturity</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead className="text-right">For sale</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length ? (
              rows.map((row) => (
                <TableRow key={row.extraction.id}>
                  <TableCell>
                    <Link
                      href={`/note/${row.extraction.id}`}
                      className="font-medium hover:text-verified"
                    >
                      {row.note.name}
                    </Link>
                    <span className="ml-2 font-mono text-xs text-muted-foreground">
                      {row.note.symbol}
                    </span>
                  </TableCell>
                  <TableCell className="tnum text-right">
                    {row.outstanding === null
                      ? "—"
                      : money(Number(formatUnits(row.outstanding, 18)))}
                  </TableCell>
                  <TableCell className="tnum text-right">
                    {percent(row.extraction.terms.interestRatePct.value)}
                  </TableCell>
                  <TableCell className="tnum">
                    {monthYear(row.extraction.terms.maturityDate.value)}
                  </TableCell>
                  <TableCell className="tnum text-right text-muted-foreground">
                    {row.periodsPaid}/{row.periodCount || "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.forSale > 0n ? (
                      <Link
                        href={`/note/${row.extraction.id}`}
                        className="tnum text-verified hover:underline"
                      >
                        {tokens(row.forSale)} @{" "}
                        {money(Number(formatUnits(row.pricePerToken, 6)))}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Stamp tone={statusTone(row.status)}>
                      {NOTE_STATUS[row.status] ?? "Unknown"}
                    </Stamp>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  {isError
                    ? "The extraction service is unreachable."
                    : isPending
                      ? "Loading…"
                      : "No notes have been issued yet."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>What you are looking at</CardTitle>
          <CardDescription>
            These are debt instruments, not a yield product.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Outstanding falls as the borrower repays principal, and every
            holder&rsquo;s balance falls with it in the same proportion. That is
            amortization, not a loss — the repaid principal is waiting in the
            vault to be claimed.
          </p>
          <p>
            Notes are sold by the issuer that originated them, at par by
            default — one token is a claim on one unit of outstanding
            principal. There is no order book behind this and no market maker:
            a primary sale is the issuer placing part of a loan, and nobody is
            obliged to buy it back.
          </p>
          <p>
            A note in the registry means its issuer was admitted, and that its
            terms match the document it was minted from. It is not a judgement
            on whether the borrower will pay. Credit risk stays with the holder.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function tokens(value: bigint): string {
  return Number(formatUnits(value, 18)).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
}
