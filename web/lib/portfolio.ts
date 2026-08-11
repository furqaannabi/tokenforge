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
import { useExtractions } from "./queries";
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
  const extractions = useExtractions();

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
export function useNotesMarket() {
  const { minted, isPending, isError } = useMintedNotes();

  const contracts = useMemo(
    () =>
      minted.flatMap((extraction) => {
        const note = extraction.note!;
        return [
          {
            abi: rwaNoteAbi,
            address: note.noteAddress,
            chainId: CHAIN_ID,
            functionName: "totalSupply",
          },
          {
            abi: rwaNoteAbi,
            address: note.noteAddress,
            chainId: CHAIN_ID,
            functionName: "status",
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
        const at = (offset: number) =>
          reads.data?.[index * 6 + offset]?.result;
        return {
          extraction,
          note: extraction.note!,
          outstanding: (at(0) as bigint | undefined) ?? null,
          status: Number((at(1) as number | undefined) ?? 0),
          periodsPaid: Number((at(2) as bigint | undefined) ?? 0n),
          periodCount: Number((at(3) as bigint | undefined) ?? 0n),
          /** Tokens on offer right now, or 0n when nothing is for sale. */
          forSale: (at(4) as bigint | undefined) ?? 0n,
          pricePerToken: (at(5) as bigint | undefined) ?? 0n,
        };
      }),
    [minted, reads.data],
  );

  return { rows, isPending, isError };
}

/** `NoteStatus` as the contract enumerates it. */
export const NOTE_STATUS = ["Active", "Matured", "Impaired"] as const;

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

