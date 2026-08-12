"use client";

import { useState } from "react";
import { formatUnits } from "viem";
import { CircleAlert, Coins, ExternalLink, Loader2, Wallet } from "lucide-react";
import { FieldLabel, StatTile } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useAllowance,
  useClaim,
  useHolderPosition,
  useMintTestCurrency,
  useNextPeriodDue,
  useNoteState,
  useSettlePeriod,
  useVaultProgress,
} from "@/lib/repayment";
import { useWallet } from "@/lib/wallet";
import { CURRENCY_DECIMALS } from "@tokenforge/core";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
import { truncateHex } from "@/lib/format";
import type { Currency } from "@tokenforge/core";

/**
 * A minted note, read from the chain.
 *
 * Everything shown here comes from the contracts rather than from the app's own
 * record, which matters most for the balance: it falls as principal is repaid,
 * and a stored copy would go stale the moment a period settled.
 */
export function OnChainNote({
  note,
  vault,
  currency = "USDG",
}: {
  note: `0x${string}`;
  vault: `0x${string}`;
  currency?: Currency;
}) {
  const { address } = useWallet();
  const decimals = CURRENCY_DECIMALS[currency];

  const { state, refetch: refetchNote } = useNoteState(note);
  const position = useHolderPosition(note, vault, address);
  const progress = useVaultProgress(vault);
  const due = useNextPeriodDue(vault, progress.nextPeriod);
  const allowance = useAllowance(address, vault);

  const settle = useSettlePeriod(vault);
  const claim = useClaim(vault);
  const faucet = useMintTestCurrency();
  const [error, setError] = useState<string | null>(null);

  /*
   * Repaying belongs to the borrower, not the issuer and not a holder.
   *
   * `settleNextPeriod` pulls the payment from whoever signs it, so showing the
   * button to the wrong party offers them the chance to pay someone else's
   * loan out of their own pocket. The issuer originated this loan and sold it;
   * they are owed nothing and owe nothing. Everyone else still sees what is
   * due and when, because that is when they get paid.
   *
   * Notes from factories that predate the borrower role have a zero address
   * there. Falling back to the issuer keeps those payable rather than
   * stranding them.
   */
  const payer =
    state?.borrower && state.borrower !== ZERO_ADDRESS
      ? state.borrower
      : state?.issuer;
  const isBorrower =
    Boolean(address) &&
    Boolean(payer) &&
    payer!.toLowerCase() === address!.toLowerCase();

  const period = due.data as
    | { dueDate: bigint; principal: bigint; interest: bigint }
    | undefined;
  const amountDue = period ? period.principal + period.interest : 0n;
  const finished = progress.nextPeriod >= progress.periodCount;

  const refresh = () => {
    void refetchNote();
    void position.refetch();
    void progress.refetch();
    void allowance.refetch();
  };

  const money = (value: bigint) =>
    `${Number(formatUnits(value, decimals)).toLocaleString("en-US", {
      maximumFractionDigits: 2,
    })} ${currency}`;

  const tokens = (value: bigint) =>
    Number(formatUnits(value, 18)).toLocaleString("en-US", {
      maximumFractionDigits: 4,
    });

  const onSettle = async () => {
    setError(null);
    try {
      await settle.run(amountDue, (allowance.data as bigint) ?? 0n);
      refresh();
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  const onClaim = async () => {
    setError(null);
    try {
      await claim.claim();
      refresh();
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  const repaidPct = state?.principal
    ? Number((state.principalRepaid * 10_000n) / state.principal) / 100
    : 0;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Outstanding"
          value={state ? money(state.principal - state.principalRepaid) : "—"}
          sub={`${repaidPct.toFixed(1)}% of principal repaid`}
        />
        <StatTile
          label="Token supply"
          value={state ? tokens(state.totalSupply) : "—"}
          sub="Falls as principal returns"
        />
        <StatTile
          label="Your holding"
          value={tokens(position.balance)}
          tone={position.balance > 0n ? "verified" : undefined}
          sub={`${tokens(position.shares)} shares — ownership is unchanged`}
        />
        <StatTile
          label="Claimable"
          value={money(position.claimable)}
          tone={position.claimable > 0n ? "verified" : undefined}
          sub={`Period ${Math.min(progress.nextPeriod + 1, progress.periodCount)} of ${progress.periodCount}`}
        />
      </div>

      {error ? (
        <p className="flex items-start gap-1.5 text-sm text-impaired">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{isBorrower ? "Repay" : "Next payment"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {finished ? (
              <p className="text-sm text-muted-foreground">
                Every period has settled. The loan is repaid and no balance
                remains outstanding.
              </p>
            ) : (
              <>
                <Row label={`Period ${progress.nextPeriod + 1} due`} value={money(amountDue)} />
                {period?.dueDate ? (
                  <Row
                    label="Due date"
                    value={new Date(
                      Number(period.dueDate) * 1000,
                    ).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  />
                ) : null}
                {period && period.principal > 0n ? (
                  <p className="text-xs text-muted-foreground">
                    {money(period.principal)} of this is principal, so every
                    holder&apos;s balance falls by the same fraction when it
                    settles.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Interest only — balances are untouched. Interest is a
                    payment on the loan, not a repayment of it.
                  </p>
                )}

                {isBorrower ? (
                  <>
                    <Button
                      className="w-full"
                      onClick={onSettle}
                      disabled={settle.isApproving || settle.isSettling}
                    >
                      {settle.isApproving ? (
                        <>
                          <Loader2 className="animate-spin" /> Approving{" "}
                          {currency}…
                        </>
                      ) : settle.isSettling ? (
                        <>
                          <Loader2 className="animate-spin" /> Settling…
                        </>
                      ) : (
                        <>
                          <Coins /> Repay {money(amountDue)}
                        </>
                      )}
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      disabled={!address || faucet.isPending}
                      onClick={() =>
                        address && faucet.mint(address, amountDue * 2n)
                      }
                    >
                      {faucet.isPending ? (
                        <>
                          <Loader2 className="animate-spin" /> Minting…
                        </>
                      ) : (
                        <>
                          <Wallet /> Get test {currency}
                        </>
                      )}
                    </Button>
                    {settle.settleHash ? (
                      <TxLink hash={settle.settleHash} />
                    ) : null}
                  </>
                ) : (
                  <p className="border-t border-border pt-3 text-xs text-muted-foreground">
                    The borrower settles this payment. When they do, your
                    balance amortizes by the principal portion and your share of
                    the whole instalment becomes claimable.
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Claim</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Row label="Your share" value={money(position.claimable)} />
            <p className="text-xs text-muted-foreground">
              Claim whenever you like — collecting after every period earns
              exactly as much as waiting until the end.
            </p>

            <Button
              className="w-full"
              onClick={onClaim}
              disabled={position.claimable === 0n || claim.isSigning || claim.isConfirming}
            >
              {claim.isSigning || claim.isConfirming ? (
                <>
                  <Loader2 className="animate-spin" /> Claiming…
                </>
              ) : (
                "Claim"
              )}
            </Button>

            {claim.hash ? <TxLink hash={claim.hash} /> : null}
          </CardContent>
        </Card>
      </div>

    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <FieldLabel>{label}</FieldLabel>
      <span className="text-right text-sm">{value}</span>
    </div>
  );
}


function TxLink({ hash }: { hash: `0x${string}` }) {
  return (
    <a
      href={`https://www.oklink.com/xlayer-test/tx/${hash}`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 font-mono text-xs text-verified hover:underline"
    >
      {truncateHex(hash, 10, 8)} <ExternalLink className="size-3" />
    </a>
  );
}
