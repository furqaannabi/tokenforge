"use client";

import { useState } from "react";
import { formatUnits } from "viem";
import { useQueryClient } from "@tanstack/react-query";
import { CircleAlert, Loader2, ShieldCheck, ShieldOff, Zap } from "lucide-react";
import { Stamp } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  useAutopay,
  useAuthorizeAutopay,
  useCollectNow,
  useNextPeriodDue,
  useVaultProgress,
} from "@/lib/repayment";
import { useCurrencyBalance } from "@/lib/sale";
import { useWallet } from "@/lib/wallet";
import { CURRENCY_DECIMALS } from "@tokenforge/core";

/**
 * Automatic repayment, which is an allowance and nothing else.
 *
 * The borrower grants the vault standing permission to pull instalments in the
 * settlement currency. Once a due date passes, anyone can trigger the
 * collection — a keeper does it on a schedule — and the vault takes exactly
 * the scheduled amount from the borrower's balance and credits it across the
 * holders.
 *
 * The design worth defending is that there is nothing to cancel. No
 * subscription, no counterparty to email, no notice period: the borrower
 * lowers the allowance and collection stops on the next block. That is the
 * only reason a standing authorization over somebody's balance is acceptable,
 * so the interface says it plainly rather than burying it.
 *
 * Shown to everyone. A holder deciding whether to buy wants to know whether
 * repayment is armed or whether each period waits on someone remembering.
 */
export function Autopay({
  vault,
  borrower,
  currency = "USDG",
}: {
  vault: `0x${string}`;
  borrower: `0x${string}`;
  currency?: keyof typeof CURRENCY_DECIMALS;
}) {
  const { address } = useWallet();
  const queryClient = useQueryClient();
  const autopay = useAutopay(vault);
  const progress = useVaultProgress(vault);
  const nextDue = useNextPeriodDue(vault, progress.nextPeriod);
  const authorize = useAuthorizeAutopay(vault);
  const collector = useCollectNow(vault);
  const balance = useCurrencyBalance(borrower);
  const [error, setError] = useState<string | null>(null);

  const decimals = CURRENCY_DECIMALS[currency];
  const isBorrower =
    Boolean(address) && borrower.toLowerCase() === address!.toLowerCase();

  const period = nextDue.data as
    | { dueDate: bigint; principal: bigint; interest: bigint }
    | undefined;
  const instalment = period ? period.principal + period.interest : 0n;
  const settled = progress.nextPeriod >= progress.periodCount;

  /*
   * Instalments covered, not a currency amount.
   *
   * "You have authorised 12,500 USDG" makes the borrower do the division. What
   * they want to know is how many payments will go through before anyone has
   * to touch this again.
   */
  const covered =
    instalment > 0n ? Number(autopay.authorized / instalment) : 0;
  const armed = autopay.authorized >= instalment && instalment > 0n;

  const money = (value: bigint) =>
    `${Number(formatUnits(value, decimals)).toLocaleString("en-US", {
      maximumFractionDigits: 2,
    })} ${currency}`;

  const dueDate = period
    ? new Date(Number(period.dueDate) * 1000).toLocaleDateString("en-US", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  const busy =
    authorize.isSigning ||
    authorize.isConfirming ||
    collector.isSigning ||
    collector.isConfirming;

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      // The allowance changes what the keeper can do and what this panel says
      // about it; a collection moves balances on every screen showing this note.
      await queryClient.invalidateQueries();
      await autopay.refetch();
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  if (settled) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Zap className="size-4" /> Automatic repayment
            </CardTitle>
            <CardDescription>
              {armed
                ? "The vault can collect each instalment when it falls due. No one has to remember."
                : "Each instalment waits on someone paying it by hand."}
            </CardDescription>
          </div>
          <Stamp tone={armed ? "verified" : "review"}>
            {armed ? "Armed" : "Not armed"}
          </Stamp>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <dl className="grid gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">Instalments paid</dt>
            <dd className="tnum">
              {progress.nextPeriod} of {progress.periodCount}
              <span className="block text-xs text-muted-foreground">
                {progress.periodCount - progress.nextPeriod} left
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Next instalment</dt>
            <dd className="tnum">
              {instalment > 0n ? money(instalment) : "—"}
              {dueDate ? (
                <span className="block text-xs text-muted-foreground">
                  due {dueDate}
                </span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Authorized</dt>
            <dd className="tnum">
              {money(autopay.authorized)}
              <span className="block text-xs text-muted-foreground">
                {armed
                  ? `covers ${Math.min(
                      covered,
                      progress.periodCount - progress.nextPeriod,
                    )} of ${progress.periodCount - progress.nextPeriod} left`
                  : "not enough for the next one"}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">
              Borrower&rsquo;s balance
            </dt>
            <dd className="tnum">
              {money(balance.data ?? 0n)}
              {(balance.data ?? 0n) < instalment ? (
                <span className="block text-xs text-impaired">
                  short of the next instalment
                </span>
              ) : null}
            </dd>
          </div>
        </dl>

        {/*
          An allowance is a promise to pay, not money set aside. Saying so here
          avoids the failure where a borrower authorizes the whole schedule,
          assumes it is handled, and defaults with an empty balance.
        */}
        {armed ? (
          <p className="text-xs text-muted-foreground">
            An authorization is permission, not a reserve. The balance still has
            to be there on the day.
          </p>
        ) : null}

        {error ? (
          <p className="flex items-start gap-1.5 text-xs text-impaired">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
            {error}
          </p>
        ) : null}

        {isBorrower ? (
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => run(() => authorize.authorize(autopay.outstanding))}
              disabled={busy || autopay.outstanding === 0n}
            >
              {authorize.isSigning || authorize.isConfirming ? (
                <>
                  <Loader2 className="animate-spin" />
                  {authorize.isSigning
                    ? "Confirm in wallet…"
                    : "Waiting for the chain…"}
                </>
              ) : (
                <>
                  <ShieldCheck />
                  {armed ? "Re-authorize" : "Authorize"} the rest —{" "}
                  {money(autopay.outstanding)}
                </>
              )}
            </Button>

            {instalment > 0n ? (
              <Button
                variant="outline"
                onClick={() => run(() => authorize.authorize(instalment))}
                disabled={busy}
              >
                Just the next one
              </Button>
            ) : null}

            {autopay.authorized > 0n ? (
              <Button
                variant="ghost"
                onClick={() => run(() => authorize.authorize(0n))}
                disabled={busy}
              >
                <ShieldOff /> Revoke
              </Button>
            ) : null}
          </div>
        ) : null}

        {/*
          Unpermissioned by design, so the button is shown to whoever is
          looking. It only ever moves the borrower's money, only once due, and
          only as far as their own allowance permits.
        */}
        {autopay.collectible ? (
          <div className="rounded-md border border-verified/40 bg-verified/5 p-3">
            <p className="text-xs">
              This instalment is due and fully authorized. The keeper collects
              it on its next pass — or anyone can trigger it now.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => run(() => collector.collect())}
              disabled={busy}
            >
              {collector.isSigning || collector.isConfirming ? (
                <>
                  <Loader2 className="animate-spin" />
                  {collector.isSigning
                    ? "Confirm in wallet…"
                    : "Waiting for the chain…"}
                </>
              ) : (
                "Collect now"
              )}
            </Button>
          </div>
        ) : autopay.overdue ? (
          <p className="flex items-start gap-1.5 text-xs text-impaired">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
            This instalment is past due and cannot be collected —{" "}
            {autopay.authorized < instalment
              ? "the authorization does not cover it."
              : "the borrower's balance is short."}
          </p>
        ) : null}

        {isBorrower ? (
          <p className="text-xs text-muted-foreground">
            Revoking takes effect on the next block. Nothing here can be
            collected without an allowance you granted, and no one else can
            restore it.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
