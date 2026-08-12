"use client";

import { formatUnits } from "viem";
import { Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSchedule, useVaultProgress, useNoteState } from "@/lib/repayment";
import { CURRENCY_DECIMALS } from "@tokenforge/core";
import type { Currency } from "@tokenforge/core";

/**
 * What a stake of this size would actually pay, instalment by instalment.
 *
 * The panel above says how many tokens the money buys, which is the wrong unit
 * for the decision — nobody wants 0.25 of a token, they want to know what
 * arrives and when. This is that, taken from the vault's own schedule rather
 * than the extracted one, because the vault is what will pay it.
 *
 * Periods already settled are excluded. A buyer's shares are checkpointed
 * against the distribution accumulator the moment they receive them, so the
 * instalments paid before they bought are not theirs and showing them would
 * overstate the return.
 */
export function ReceiptsDialog({
  note,
  vault,
  amount,
  currency = "USDG",
  disabled,
}: {
  note: `0x${string}`;
  vault: `0x${string}`;
  /** Tokens the buyer would hold, 18 decimals. */
  amount: bigint;
  currency?: Currency;
  disabled?: boolean;
}) {
  const decimals = CURRENCY_DECIMALS[currency];
  const progress = useVaultProgress(vault);
  const { periods } = useSchedule(vault, progress.periodCount);
  const { state } = useNoteState(note);

  /*
   * Balance over supply, not shares over total shares. They are the same ratio
   * — both sides of each scale by the same index — and this pair is what the
   * buyer can see on screen.
   */
  const supply = state?.totalSupply ?? 0n;
  const share = (value: bigint) =>
    supply > 0n ? (value * amount) / supply : 0n;

  const remaining = periods
    .map((period, index) => ({ period, index }))
    .filter(({ period, index }) => period && index >= progress.nextPeriod);

  const totalPrincipal = remaining.reduce(
    (sum, { period }) => sum + share(period!.principal),
    0n,
  );
  const totalInterest = remaining.reduce(
    (sum, { period }) => sum + share(period!.interest),
    0n,
  );

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          <Receipt /> What you&rsquo;d receive
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>What you&rsquo;d receive</DialogTitle>
          <DialogDescription>
            Your share of every instalment still to be paid, from the vault&rsquo;s
            own schedule. Amounts become claimable as the borrower settles each
            period.
          </DialogDescription>
        </DialogHeader>

        {remaining.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {progress.periodCount === 0
              ? "Reading the schedule…"
              : "Every period has settled. There is nothing left to pay."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Due</TableHead>
                  <TableHead className="text-right">Principal</TableHead>
                  <TableHead className="text-right">Interest</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {remaining.map(({ period, index }) => {
                  const principal = share(period!.principal);
                  const interest = share(period!.interest);
                  return (
                    <TableRow key={index}>
                      <TableCell className="tnum whitespace-nowrap">
                        {new Date(
                          Number(period!.dueDate) * 1000,
                        ).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </TableCell>
                      <TableCell className="tnum text-right">
                        {money(principal, decimals)}
                      </TableCell>
                      <TableCell className="tnum text-right">
                        {money(interest, decimals)}
                      </TableCell>
                      <TableCell className="tnum text-right font-medium">
                        {money(principal + interest, decimals)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              <TableFooter>
                <TableRow className="hover:bg-transparent">
                  <TableCell className="font-medium">Total</TableCell>
                  <TableCell className="tnum text-right">
                    {money(totalPrincipal, decimals)}
                  </TableCell>
                  <TableCell className="tnum text-right">
                    {money(totalInterest, decimals)}
                  </TableCell>
                  <TableCell className="tnum text-right font-semibold text-verified">
                    {money(totalPrincipal + totalInterest, decimals)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Principal repayments shrink your balance as they arrive — that is
          amortization, not a loss. Interest is the return. None of this is
          guaranteed: if the borrower stops paying, the schedule stops with
          them.
        </p>
      </DialogContent>
    </Dialog>
  );
}

function money(value: bigint, decimals: number): string {
  return Number(formatUnits(value, decimals)).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
