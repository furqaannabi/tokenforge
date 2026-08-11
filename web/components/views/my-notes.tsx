"use client";

import { useState } from "react";
import Link from "next/link";
import { formatUnits } from "viem";
import { CircleAlert, Coins, Loader2, Wallet } from "lucide-react";
import { FieldLabel, Stamp, StatTile } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useHoldings, type Holding } from "@/lib/portfolio";
import { useClaim } from "@/lib/repayment";
import { useWallet } from "@/lib/wallet";
import { CURRENCY_DECIMALS } from "@/lib/contracts/mint";

/**
 * What the connected wallet holds.
 *
 * The counterpart to the issuer's dashboard: someone who owns part of a loan
 * needs to see what it is worth, what has been repaid to them, and be able to
 * take it. None of that goes through the service — the balances are read from
 * the notes and the claim is signed by the holder.
 */
export function MyNotesView() {
  const { address, connected } = useWallet();
  const { holdings, isPending, isError, refetch } = useHoldings(address);

  if (!connected) {
    return (
      <div className="mx-auto max-w-[600px] px-4 py-16 text-center sm:px-6">
        <Wallet className="mx-auto size-6 text-muted-foreground" />
        <h1 className="mt-3 text-xl font-semibold">Connect a wallet</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A portfolio is whatever a particular address holds, so there is
          nothing to show until one is connected.
        </p>
      </div>
    );
  }

  const decimals = CURRENCY_DECIMALS.USDG;
  const totalValue = holdings.reduce((sum, h) => sum + h.balance, 0n);
  const totalClaimable = holdings.reduce((sum, h) => sum + h.claimable, 0n);

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Portfolio
        </h1>
        <p className="mt-1 text-muted-foreground">
          Your positions, read from the chain. Balances fall as principal is
          repaid — the repaid amount is waiting in the vault below.
        </p>
      </header>

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Outstanding held"
          value={amount(totalValue, 18)}
          sub="Face value of your stakes today"
        />
        <StatTile
          label="Claimable"
          value={`${amount(totalClaimable, decimals)} USDG`}
          tone={totalClaimable > 0n ? "verified" : undefined}
          sub="Repayments waiting for you"
        />
        <StatTile
          label="Positions"
          value={String(holdings.length)}
          sub={holdings.length === 1 ? "note held" : "notes held"}
        />
      </div>

      {holdings.length ? (
        <div className="space-y-4">
          {holdings.map((holding) => (
            <HoldingCard
              key={holding.extraction.id}
              holding={holding}
              onClaimed={refetch}
            />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {isError
              ? "Positions could not be read. The extraction service supplies the list of notes; check that it is running."
              : isPending
                ? "Reading positions…"
                : "This wallet holds no notes."}
            <p className="mt-3">
              <Link href="/" className="text-verified hover:underline">
                Browse issued notes
              </Link>
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * One position, with its claim.
 *
 * Shares sit next to the balance rather than being hidden, because they are
 * what stays constant: a holder who sees only the balance drop after a
 * repayment has been told half the story.
 */
function HoldingCard({
  holding,
  onClaimed,
}: {
  holding: Holding;
  onClaimed: () => void;
}) {
  const claim = useClaim(holding.vault);
  const [error, setError] = useState<string | null>(null);
  const decimals = CURRENCY_DECIMALS.USDG;

  const onClaim = async () => {
    setError(null);
    try {
      await claim.claim();
      onClaimed();
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  const busy = claim.isSigning || claim.isConfirming;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>
              <Link
                href={`/note/${holding.extraction.id}`}
                className="hover:text-verified"
              >
                {holding.name}
              </Link>
            </CardTitle>
            <CardDescription>
              {holding.extraction.terms.borrower.value}
            </CardDescription>
          </div>
          <Stamp tone="neutral">{holding.symbol}</Stamp>
        </div>
      </CardHeader>

      <CardContent>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Figure label="Balance" value={amount(holding.balance, 18)} />
          <Figure label="Shares" value={amount(holding.shares, 18)} />
          <Figure
            label="Claimable"
            value={`${amount(holding.claimable, decimals)} USDG`}
            tone={holding.claimable > 0n ? "text-verified" : undefined}
          />
        </div>

        {error ? (
          <p className="mt-4 flex items-start gap-1.5 text-xs text-impaired">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
            {error}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            onClick={onClaim}
            disabled={busy || holding.claimable === 0n}
          >
            {busy ? (
              <>
                <Loader2 className="animate-spin" />
                {claim.isSigning ? "Confirm in wallet…" : "Waiting for the chain…"}
              </>
            ) : (
              <>
                <Coins /> Claim
              </>
            )}
          </Button>
          {holding.claimable === 0n ? (
            <span className="text-xs text-muted-foreground">
              Nothing to claim until the issuer settles the next period.
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div>
      <FieldLabel className="block">{label}</FieldLabel>
      <p className={`tnum mt-1 text-sm font-medium ${tone ?? ""}`}>{value}</p>
    </div>
  );
}

function amount(value: bigint, decimals: number): string {
  return Number(formatUnits(value, decimals)).toLocaleString("en-US", {
    maximumFractionDigits: 4,
  });
}
