"use client";

import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import {
  CHAIN_ID,
  addresses,
  rwaNoteAbi,
  repaymentVaultAbi,
  saleDeskAbi,
} from "./contracts";
import { useMintedExtractions } from "./queries";
import type { ApiExtractionSummary } from "./api";

/**
 * What a holder owns, read from the chain.
 *
 * The service knows which notes exist; it does not know who holds them, and it
 * shouldn't — a transfer is an ERC-20 call that never touches this app. So the
 * list of notes comes from the service and every figure about a holding comes
 * from a multicall against the notes themselves.
 *
 * Balance and shares are both surfaced because they answer different
 * questions. Shares are the unchanging record of how much of the loan someone
 * owns; the balance is what that stake is worth today, and it falls as
 * principal is repaid. A holder watching only the balance would think their
 * position was shrinking, when in fact they were being paid.
 */

export interface Holding {
  extraction: ApiExtractionSummary;
  note: `0x${string}`;
  vault: `0x${string}`;
  name: string;
  symbol: string;
  /** Worth today, 18 decimals. Falls as principal amortizes. */
  balance: bigint;
  /** Ownership, 18 decimals. Constant unless tokens move. */
  shares: bigint;
  /** Repayments waiting to be claimed, in the settlement currency. */
  claimable: bigint;
}

/*
 * There is deliberately no "already received" figure here.
 *
 * The vault keeps `totalClaimed` across all holders but no per-holder running
 * total — the accumulator does not need one. It is recoverable from the
 * `Claimed` logs, which index the holder, except that X Layer's public RPC
 * caps `eth_getLogs` at a hundred-block range; recovering it would mean
 * thousands of requests per page load. Showing a number that could not be kept
 * correct would be worse than not showing one.
 */

/** Every minted note, whether or not the viewer holds any of it. */
export function useMintedNotes() {
  const extractions = useMintedExtractions();

  const minted = useMemo(
    () =>
      (extractions.data ?? []).filter(
        (extraction) => extraction.status === "MINTED" && extraction.note,
      ),
    [extractions.data],
  );

  return { ...extractions, minted };
}

/**
 * Every minted note with its live state, for the browse list.
 *
 * `totalSupply` rather than the original principal, because the two diverge
 * the moment a period settles: the supply is what is still outstanding, and
 * that is the number an investor is deciding about.
 */
/**
 * Reads queued per note below.
 *
 * Named, because the results come back as one flat array and the only thing
 * separating one note's fields from the next is this number.
 */
const READS_PER_NOTE = 8;

export function useNotesMarket() {
  const { minted, isPending, isError } = useMintedNotes();

  const contracts = useMemo(
    () =>
      minted.flatMap((extraction) => {
        const note = extraction.note!;
        return [
          /*
           * Outstanding principal comes from the two figures that define it,
           * in the settlement currency's decimals. `totalSupply` was standing
           * in for it and is a different quantity entirely — a token count in
           * 18 decimals — so a note with $1,050,000 still owed rendered as
           * "$875", which is its supply of tokens.
           */
          {
            abi: rwaNoteAbi,
            address: note.noteAddress,
            chainId: CHAIN_ID,
            functionName: "principal",
          },
          {
            abi: rwaNoteAbi,
            address: note.noteAddress,
            chainId: CHAIN_ID,
            functionName: "principalRepaid",
          },
          {
            abi: rwaNoteAbi,
            address: note.noteAddress,
            chainId: CHAIN_ID,
            functionName: "status",
          },
          {
            abi: rwaNoteAbi,
            address: note.noteAddress,
            chainId: CHAIN_ID,
            functionName: "borrower",
          },
          {
            abi: repaymentVaultAbi,
            address: note.vaultAddress,
            chainId: CHAIN_ID,
            functionName: "nextPeriod",
          },
          {
            abi: repaymentVaultAbi,
            address: note.vaultAddress,
            chainId: CHAIN_ID,
            functionName: "periodCount",
          },
          // What a browsing investor is actually looking for.
          {
            abi: saleDeskAbi,
            address: addresses.saleDesk,
            chainId: CHAIN_ID,
            functionName: "available",
            args: [note.noteAddress],
          },
          {
            abi: saleDeskAbi,
            address: addresses.saleDesk,
            chainId: CHAIN_ID,
            functionName: "price",
            args: [note.noteAddress],
          },
        ];
      }),
    [minted],
  );

  const reads = useReadContracts({
    contracts,
    query: { enabled: contracts.length > 0, refetchInterval: 30_000 },
  });

  const rows = useMemo(
    () =>
      minted.map((extraction, index) => {
        /*
         * The stride must match the number of reads queued per note above.
         * It said six against seven calls, so every note after the first read
         * its neighbour's fields — and `forSale` and `price` were a slot
         * short even on the first, printing the period count as a quantity
         * for sale and a token supply as the price.
         */
        const at = (offset: number) =>
          reads.data?.[index * READS_PER_NOTE + offset]?.result;

        const principal = (at(0) as bigint | undefined) ?? null;
        const repaid = (at(1) as bigint | undefined) ?? 0n;

        return {
          extraction,
          note: extraction.note!,
          /** Still owed, in the settlement currency. */
          outstanding: principal === null ? null : principal - repaid,
          status: Number((at(2) as number | undefined) ?? 0),
          borrower: (at(3) as `0x${string}` | undefined) ?? "0x",
          periodsPaid: Number((at(4) as bigint | undefined) ?? 0n),
          periodCount: Number((at(5) as bigint | undefined) ?? 0n),
          /** Tokens on offer right now, or 0n when nothing is for sale. */
          forSale: (at(6) as bigint | undefined) ?? 0n,
          pricePerToken: (at(7) as bigint | undefined) ?? 0n,
        };
      }),
    [minted, reads.data],
  );

  /*
   * A note whose borrower has not accepted is not an issued note yet. It
   * cannot be transferred, offered, or repaid, and listing it publicly would
   * advertise an instrument nobody has agreed to owe. Its issuer still sees it
   * on their own tab, which is where the acceptance is being waited on.
   */
  const live = rows.filter((row) => row.status !== 3);

  return { rows: live, pending: rows.filter((r) => r.status === 3), isPending, isError };
}

/**
 * `RWANote.Status`, in the contract's own order.
 *
 * This list previously read Active/Matured/Impaired, which had the last two
 * transposed — a defaulted loan rendered as "Matured", the one mislabelling
 * that turns the worst outcome into the best. `Pending` is appended because
 * the enum appends it, so that Active stays zero for notes already minted.
 */
export const NOTE_STATUS = [
  "Active",
  "Impaired",
  "Matured",
  "Pending",
] as const;

/**
 * The colour a status should carry, in one place.
 *
 * Two screens each mapped these by hand and one had impaired and matured the
 * wrong way round, painting a defaulted loan in the tone reserved for one that
 * had paid in full.
 */
export function statusTone(
  status: number,
): "verified" | "impaired" | "review" | "neutral" {
  switch (status) {
    case 1:
      return "impaired";
    case 2:
      return "neutral";
    case 3:
      return "review";
    default:
      return "verified";
  }
}

/**
 * The connected wallet's positions.
 *
 * Notes the wallet has no stake in are dropped: a portfolio listing every note
 * in the system at zero would bury the ones that matter.
 */
export function useHoldings(holder?: `0x${string}`) {
  const { minted, isPending: notesPending, isError, refetch } = useMintedNotes();

  const contracts = useMemo(() => {
    if (!holder) return [];
    return minted.flatMap((extraction) => {
      const note = extraction.note!;
      return [
        {
          abi: rwaNoteAbi,
          address: note.noteAddress,
          chainId: CHAIN_ID,
          functionName: "balanceOf",
          args: [holder],
        },
        {
          abi: rwaNoteAbi,
          address: note.noteAddress,
          chainId: CHAIN_ID,
          functionName: "sharesOf",
          args: [holder],
        },
        {
          abi: repaymentVaultAbi,
          address: note.vaultAddress,
          chainId: CHAIN_ID,
          functionName: "claimable",
          args: [holder],
        },
      ];
    });
  }, [minted, holder]);

  const reads = useReadContracts({
    contracts,
    query: { enabled: contracts.length > 0, refetchInterval: 15_000 },
  });

  const holdings = useMemo<Holding[]>(() => {
    if (!reads.data) return [];

    const rows: Holding[] = [];
    minted.forEach((extraction, index) => {
      const note = extraction.note!;
      const at = (offset: number) =>
        (reads.data![index * 3 + offset]?.result as bigint | undefined) ?? 0n;

      const balance = at(0);
      const shares = at(1);
      const claimable = at(2);

      // A wallet that has transferred its whole holding away may still be owed
      // the repayments that accrued while it held them, so both are checked.
      if (balance === 0n && claimable === 0n) return;

      rows.push({
        extraction,
        note: note.noteAddress,
        vault: note.vaultAddress,
        name: note.name,
        symbol: note.symbol,
        balance,
        shares,
        claimable,
      });
    });
    return rows;
  }, [reads.data, minted]);

  return {
    holdings,
    isPending: notesPending || (contracts.length > 0 && reads.isPending),
    isError: isError || reads.isError,
    refetch: () => {
      void refetch();
      void reads.refetch();
    },
  };
}

