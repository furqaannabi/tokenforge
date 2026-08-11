"use client";

import { useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { CircleAlert, Coins, Loader2, Store, Tag } from "lucide-react";
import { FieldLabel, Stamp } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  useBuyFromOffer,
  useCloseOffer,
  useFundOffer,
  useOffer,
  useSetPrice,
  useWithdrawPool,
} from "@/lib/sale";
import { useHolderPosition, useNoteState } from "@/lib/repayment";
import { useWallet } from "@/lib/wallet";
import { CURRENCY_DECIMALS } from "@/lib/contracts/mint";
import { addresses } from "@/lib/contracts";
import type { Currency } from "@tokenforge/core";

/**
 * The primary offering, from both sides.
 *
 * A note is minted entirely to its issuer, so this is the only path by which
 * anyone else comes to hold one. The issuer sees a pool they size as a share of
 * the loan; everyone else sees what is for sale and what it costs.
 */
export function Offering({
  note,
  vault,
  currency = "USDG",
}: {
  note: `0x${string}`;
  vault: `0x${string}`;
  currency?: Currency;
}) {
  const { address } = useWallet();
  const { state } = useNoteState(note);
  const { offer, refetch } = useOffer(note);

  if (!addresses.saleDesk) return null;

  const isIssuer =
    Boolean(address) &&
    Boolean(state?.issuer) &&
    state!.issuer.toLowerCase() === address!.toLowerCase();

  return isIssuer ? (
    <IssuerOffering
      note={note}
      vault={vault}
      currency={currency}
      supply={state?.totalSupply ?? 0n}
      offer={offer}
      onChange={refetch}
    />
  ) : (
    <InvestorOffering
      note={note}
      currency={currency}
      offer={offer}
      onChange={refetch}
    />
  );
}

type Offer = NonNullable<ReturnType<typeof useOffer>["offer"]>;

/**
 * The issuer's side: how much of this loan to sell.
 *
 * The input is a percentage because that is the decision — "I will keep 60% of
 * this and place the rest" — while the token count is arithmetic. The price is
 * not asked for at all by default: a token is a claim on one unit of
 * outstanding principal, so par is what makes the proceeds equal what is being
 * sold, and the desk recomputes it as the note amortizes rather than freezing
 * it. An issuer who wants a premium or a discount can still say so.
 */
function IssuerOffering({
  note,
  vault,
  currency,
  supply,
  offer,
  onChange,
}: {
  note: `0x${string}`;
  vault: `0x${string}`;
  currency: Currency;
  supply: bigint;
  offer?: Offer;
  onChange: () => void;
}) {
  const { address } = useWallet();
  const position = useHolderPosition(note, vault, address);
  const fund = useFundOffer(note);
  const withdraw = useWithdrawPool(note);
  const reprice = useSetPrice(note);
  const close = useCloseOffer(note);

  const decimals = CURRENCY_DECIMALS[currency];
  const [pct, setPct] = useState("40");
  const [priceInput, setPriceInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const par = offer?.parPrice ?? 0n;
  const pool = offer?.available ?? 0n;
  const open = offer?.open ?? false;

  /*
   * The percentage is of total supply, but the tokens come out of what the
   * issuer still holds. Those differ once part of the note has been sold, so
   * the amount is capped at the holding rather than silently reverting on
   * transfer.
   */
  const share = Number(pct) / 100;
  const wanted =
    Number.isFinite(share) && share > 0
      ? (supply * BigInt(Math.round(share * 10_000))) / 10_000n
      : 0n;
  const amount = wanted > position.balance ? position.balance : wanted;
  const proceeds = (amount * (offer?.price ?? par)) / 10n ** 18n;

  const busy = fund.isApproving || fund.isFunding;

  const onFund = async () => {
    setError(null);
    try {
      const override = priceInput.trim()
        ? parseUnits(priceInput.trim(), decimals)
        : 0n;
      await fund.run(amount, override, open);
      onChange();
      void position.refetch();
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  const act = async (run: () => Promise<unknown>) => {
    setError(null);
    try {
      await run();
      onChange();
      void position.refetch();
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Store className="size-4" /> Offering
            </CardTitle>
            <CardDescription>
              You hold the whole note. Place part of it for sale so investors
              can buy in.
            </CardDescription>
          </div>
          {open ? (
            <Stamp tone="verified">Open</Stamp>
          ) : (
            <Stamp tone="neutral">Not offered</Stamp>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {open ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Figure label="In pool" value={tokens(pool)} />
            <Figure label="Share of note" value={`${(offer!.poolBps / 100).toFixed(1)}%`} />
            <Figure
              label="Price / token"
              value={`${money(offer!.price, decimals)} ${currency}`}
              sub={offer!.priceOverride > 0n ? "your price" : "at par"}
            />
            <Figure
              label="Raised"
              value={`${money(offer!.raised, decimals)} ${currency}`}
            />
          </div>
        ) : null}

        <div className="space-y-3 border-t border-border pt-4">
          <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <FieldLabel>
                {open ? "Add to pool — share of note" : "Share of note to sell"}
              </FieldLabel>
              <span className="text-xs text-muted-foreground">
                you hold {tokens(position.balance)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={pct}
                onChange={(event) => setPct(event.target.value)}
                inputMode="decimal"
                className="tnum text-sm"
                disabled={busy}
              />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {["10", "25", "40", "50", "75"].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setPct(preset)}
                  className="rounded border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  {preset}%
                </button>
              ))}
            </div>
          </div>

          {!open ? (
            <div>
              <FieldLabel className="mb-1.5 block">
                Price per token — leave blank for par
              </FieldLabel>
              <Input
                value={priceInput}
                onChange={(event) => setPriceInput(event.target.value)}
                placeholder={`${money(par, decimals)} (par)`}
                inputMode="decimal"
                className="tnum text-sm"
                disabled={busy}
              />
            </div>
          ) : null}

          {/*
            The number the issuer actually cares about. Everything above is how
            much of the loan leaves; this is what arrives if it all sells.
          */}
          <div className="rounded-lg border border-border bg-background px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <FieldLabel>You receive if fully taken</FieldLabel>
              <span className="tnum text-lg font-semibold text-verified">
                {money(proceeds, decimals)} {currency}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {tokens(amount)} tokens at{" "}
              {money(offer?.price ?? par, decimals)} {currency} each.
              {wanted > position.balance
                ? " Capped at what you still hold."
                : ""}
            </p>
          </div>

          {error ? (
            <p className="flex items-start gap-1.5 text-xs text-impaired">
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button onClick={onFund} disabled={busy || amount === 0n}>
              {fund.isApproving ? (
                <>
                  <Loader2 className="animate-spin" /> Approving…
                </>
              ) : fund.isFunding ? (
                <>
                  <Loader2 className="animate-spin" /> Placing…
                </>
              ) : (
                <>
                  <Store /> {open ? "Add to pool" : "Open offering"}
                </>
              )}
            </Button>

            {open ? (
              <>
                <Button
                  variant="outline"
                  disabled={withdraw.isPending || pool === 0n}
                  onClick={() => act(() => withdraw.withdraw(pool))}
                >
                  {withdraw.isPending ? (
                    <>
                      <Loader2 className="animate-spin" /> Withdrawing…
                    </>
                  ) : (
                    "Withdraw pool"
                  )}
                </Button>
                <Button
                  variant="outline"
                  disabled={reprice.isPending}
                  onClick={() =>
                    act(() =>
                      reprice.setPrice(
                        priceInput.trim()
                          ? parseUnits(priceInput.trim(), decimals)
                          : 0n,
                      ),
                    )
                  }
                >
                  <Tag /> Reprice
                </Button>
                <Button
                  variant="outline"
                  disabled={close.isPending}
                  onClick={() => act(() => close.close())}
                >
                  Close
                </Button>
              </>
            ) : null}
          </div>

          {open ? (
            <div>
              <FieldLabel className="mb-1.5 block">
                New price per token — blank for par
              </FieldLabel>
              <Input
                value={priceInput}
                onChange={(event) => setPriceInput(event.target.value)}
                placeholder={`${money(par, decimals)} (par)`}
                inputMode="decimal"
                className="tnum text-sm"
              />
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

/** The investor's side: what is for sale, and what it costs. */
function InvestorOffering({
  note,
  currency,
  offer,
  onChange,
}: {
  note: `0x${string}`;
  currency: Currency;
  offer?: Offer;
  onChange: () => void;
}) {
  const buy = useBuyFromOffer(note);
  const decimals = CURRENCY_DECIMALS[currency];
  const [amountInput, setAmountInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!offer?.open || offer.available === 0n) {
    return (
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Not for sale</CardTitle>
          <CardDescription>
            The issuer has not placed any of this note on offer. Nothing can be
            bought until they do.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  let amount = 0n;
  try {
    amount = amountInput.trim() ? parseUnits(amountInput.trim(), 18) : 0n;
  } catch {
    amount = 0n;
  }
  const cost = (amount * offer.price) / 10n ** 18n;
  const tooMuch = amount > offer.available;
  const busy = buy.isApproving || buy.isBuying;

  const onBuy = async () => {
    setError(null);
    try {
      // A little headroom on the cap: the price is read on-chain at execution,
      // and a note that amortizes between quote and confirmation would
      // otherwise revert a buy the investor had already approved.
      await buy.run(amount, cost + cost / 100n);
      setAmountInput("");
      onChange();
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Coins className="size-4" /> Buy in
            </CardTitle>
            <CardDescription>
              Buying gives you a share of every remaining repayment on this
              loan.
            </CardDescription>
          </div>
          <Stamp tone="verified">Open</Stamp>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Figure label="For sale" value={tokens(offer.available)} />
          <Figure
            label="Price / token"
            value={`${money(offer.price, decimals)} ${currency}`}
            sub={offer.priceOverride > 0n ? "issuer's price" : "at par"}
          />
          <Figure
            label="Share of note"
            value={`${(offer.poolBps / 100).toFixed(1)}%`}
          />
        </div>

        <div className="space-y-3 border-t border-border pt-4">
          <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <FieldLabel>Tokens to buy</FieldLabel>
              <button
                type="button"
                onClick={() => setAmountInput(formatUnits(offer.available, 18))}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Max {tokens(offer.available)}
              </button>
            </div>
            <Input
              value={amountInput}
              onChange={(event) => setAmountInput(event.target.value)}
              placeholder="0.0"
              inputMode="decimal"
              className="tnum text-sm"
              disabled={busy}
            />
          </div>

          <div className="rounded-lg border border-border bg-background px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <FieldLabel>You pay</FieldLabel>
              <span className="tnum text-lg font-semibold">
                {money(cost, decimals)} {currency}
              </span>
            </div>
          </div>

          {tooMuch ? (
            <p className="text-xs text-review">
              Only {tokens(offer.available)} tokens are on offer.
            </p>
          ) : null}

          {error ? (
            <p className="flex items-start gap-1.5 text-xs text-impaired">
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
              {error}
            </p>
          ) : null}

          <Button
            className="w-full"
            onClick={onBuy}
            disabled={busy || amount === 0n || tooMuch}
          >
            {buy.isApproving ? (
              <>
                <Loader2 className="animate-spin" /> Approving {currency}…
              </>
            ) : buy.isBuying ? (
              <>
                <Loader2 className="animate-spin" /> Buying…
              </>
            ) : (
              <>
                <Coins /> Buy {amount > 0n ? tokens(amount) : ""} tokens
              </>
            )}
          </Button>

          <p className="text-xs text-muted-foreground">
            The issuer receives the payment directly. This is a primary sale of
            a loan participation, not a traded market — there is no order book
            and no guarantee anyone will buy it back.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function Figure({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div>
      <FieldLabel className="block">{label}</FieldLabel>
      <p className="tnum mt-1 text-sm font-medium">{value}</p>
      {sub ? (
        <p className="text-[11px] text-muted-foreground">{sub}</p>
      ) : null}
    </div>
  );
}

function tokens(value: bigint): string {
  return Number(formatUnits(value, 18)).toLocaleString("en-US", {
    maximumFractionDigits: 4,
  });
}

function money(value: bigint, decimals: number): string {
  return Number(formatUnits(value, decimals)).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
}
