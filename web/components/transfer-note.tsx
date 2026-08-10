"use client";

import { useState } from "react";
import { formatUnits, isAddress, parseUnits } from "viem";
import { CircleAlert, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FieldLabel } from "@/components/primitives";
import { useHolderPosition, useTransferNote } from "@/lib/repayment";
import { useWallet } from "@/lib/wallet";

/**
 * Sending part of a holding to another wallet.
 *
 * This is the only way a note reaches an investor: the factory mints the whole
 * supply to the issuer, who then transfers stakes out. There is no order book
 * here on purpose — who may hold a private credit note is a legal question
 * about the buyer, and a permissionless market would answer it by default.
 *
 * The amount is a balance, not shares. `RWANote` converts on the way in, so
 * sending 100 means 100 of what the token is worth today, however far principal
 * has already amortized.
 */
export function TransferNote({
  note,
  vault,
  symbol,
}: {
  note: `0x${string}`;
  vault: `0x${string}`;
  symbol: string;
}) {
  const { address } = useWallet();
  const position = useHolderPosition(note, vault, address);
  const transfer = useTransferNote(note);

  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  if (!address || position.balance === 0n) return null;

  const balance = Number(formatUnits(position.balance, 18));

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSent(null);

    if (!isAddress(to, { strict: false })) {
      setError("That is not a valid address.");
      return;
    }

    let units: bigint;
    try {
      units = parseUnits(amount, 18);
    } catch {
      setError("Enter an amount.");
      return;
    }
    if (units <= 0n) {
      setError("Enter an amount greater than zero.");
      return;
    }
    if (units > position.balance) {
      setError(`You hold ${balance.toLocaleString("en-US")} ${symbol}.`);
      return;
    }

    try {
      await transfer.transfer(to as `0x${string}`, units);
      setSent(`${amount} ${symbol} sent to ${to}.`);
      setTo("");
      setAmount("");
      void position.refetch();
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  const busy = transfer.isSigning || transfer.isConfirming;

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Transfer</CardTitle>
        <CardDescription>
          Send part of your holding to another wallet. The recipient&rsquo;s
          share of every future repayment moves with it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <FieldLabel className="mb-1.5 block">Recipient</FieldLabel>
            <Input
              value={to}
              onChange={(event) => setTo(event.target.value)}
              placeholder="0x…"
              className="font-mono text-sm"
              disabled={busy}
            />
          </div>

          <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <FieldLabel>Amount</FieldLabel>
              <button
                type="button"
                onClick={() => setAmount(formatUnits(position.balance, 18))}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Max {balance.toLocaleString("en-US", {
                  maximumFractionDigits: 4,
                })}{" "}
                {symbol}
              </button>
            </div>
            <Input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.0"
              inputMode="decimal"
              className="tnum text-sm"
              disabled={busy}
            />
          </div>

          {error ? (
            <p className="flex items-start gap-1.5 text-xs text-impaired">
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
              {error}
            </p>
          ) : null}

          {sent ? (
            <p className="text-xs break-all text-verified">{sent}</p>
          ) : null}

          <Button type="submit" size="sm" disabled={busy}>
            {busy ? (
              <>
                <Loader2 className="animate-spin" />
                {transfer.isSigning
                  ? "Confirm in wallet…"
                  : "Waiting for the chain…"}
              </>
            ) : (
              <>
                <Send /> Send
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
