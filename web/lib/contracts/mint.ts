import { encodeAbiParameters, keccak256, parseUnits } from "viem";
import type { Currency, ExtractedTerms, PaymentPeriod } from "@tokenforge/core";

/**
 * Turns reviewed terms into the arguments `NoteFactory.mintNote` expects.
 *
 * Two things have to line up exactly or the mint reverts, both by design:
 *
 *   - `scheduleHash` must reproduce `ScheduleLib.hash`, which the vault
 *     recomputes over the schedule it is handed. That check is what stops the
 *     terms a human approved being swapped for different ones on the way to the
 *     chain, so it is deliberately unforgiving.
 *   - Amounts must be in the settlement currency's decimals. The extraction
 *     works in whole units — 2,500,000 means two and a half million dollars —
 *     while the contracts count the smallest unit.
 */

/** Matches `Period` in contracts/src/Schedule.sol. */
export interface ChainPeriod {
  dueDate: bigint;
  principal: bigint;
  interest: bigint;
}

/**
 * USDG and the dollar stablecoins use six decimals.
 *
 * Read from the token in a fuller implementation; fixed here because the demo
 * deployment is a mock whose decimals are known.
 */
export const CURRENCY_DECIMALS: Record<Currency, number> = {
  USDG: 6,
  USDC: 6,
  USDT: 6,
};

/**
 * The ABI encoding of `Period[]`, which is what `ScheduleLib.hash` hashes.
 *
 * `abi.encode` of a dynamic array of structs, so the tuple layout below has to
 * match the Solidity struct field for field and in order.
 */
const PERIOD_ARRAY_TYPE = [
  {
    type: "tuple[]",
    components: [
      { name: "dueDate", type: "uint64" },
      { name: "principal", type: "uint256" },
      { name: "interest", type: "uint256" },
    ],
  },
] as const;

export function hashSchedule(schedule: readonly ChainPeriod[]): `0x${string}` {
  return keccak256(
    encodeAbiParameters(PERIOD_ARRAY_TYPE, [
      schedule.map((period) => ({
        dueDate: period.dueDate,
        principal: period.principal,
        interest: period.interest,
      })),
    ]),
  );
}

/** ISO date to the Unix seconds the contracts store. */
function toTimestamp(isoDate: string): bigint {
  return BigInt(Math.floor(new Date(`${isoDate}T00:00:00Z`).getTime() / 1000));
}

/** Whole-unit amount to the token's smallest unit. */
function toUnits(amount: number, decimals: number): bigint {
  // Via a fixed-precision string rather than multiplication: 8.5 * 1e6 in
  // floating point is not exactly 8500000, and a rounding error here would be
  // a rounding error in someone's principal.
  return parseUnits(amount.toFixed(decimals), decimals);
}

export function toChainSchedule(
  schedule: readonly PaymentPeriod[],
  decimals: number,
): ChainPeriod[] {
  return schedule.map((period) => ({
    dueDate: toTimestamp(period.dueDate),
    principal: toUnits(period.principal, decimals),
    interest: toUnits(period.interest, decimals),
  }));
}

export interface MintArgs {
  name: string;
  symbol: string;
  issuer: `0x${string}`;
  supply: bigint;
  currency: `0x${string}`;
  gracePeriod: bigint;
  terms: {
    principal: bigint;
    rateBps: number;
    maturity: bigint;
    documentHash: `0x${string}`;
    scheduleHash: `0x${string}`;
  };
  schedule: ChainPeriod[];
}

export function buildMintArgs(input: {
  terms: ExtractedTerms;
  name: string;
  symbol: string;
  issuer: `0x${string}`;
  currency: Currency;
  currencyAddress: `0x${string}`;
  documentHash: `0x${string}`;
  /** Tokens to issue, in whole units. One token is a slice of the loan. */
  supplyTokens: number;
}): MintArgs {
  const decimals = CURRENCY_DECIMALS[input.currency];
  const schedule = toChainSchedule(input.terms.schedule.value, decimals);

  return {
    name: input.name,
    symbol: input.symbol,
    issuer: input.issuer,
    // The note itself is a plain 18-decimal ERC-20; only the money it settles
    // in uses the currency's decimals.
    supply: parseUnits(String(input.supplyTokens), 18),
    currency: input.currencyAddress,
    gracePeriod: BigInt(input.terms.latePayment.value.gracePeriodDays * 86_400),
    terms: {
      principal: toUnits(input.terms.principal.value, decimals),
      // Basis points, so 8.5% is 850. Rounded because the contract stores a
      // uint16 and a fractional basis point is not a real rate.
      rateBps: Math.round(input.terms.interestRatePct.value * 100),
      maturity: toTimestamp(input.terms.maturityDate.value),
      documentHash: input.documentHash,
      scheduleHash: hashSchedule(schedule),
    },
    schedule,
  };
}
