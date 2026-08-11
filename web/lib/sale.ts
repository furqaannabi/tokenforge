"use client";

import {
  useReadContracts,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import {
  CHAIN_ID,
  addresses,
  erc20Abi,
  rwaNoteAbi,
  saleDeskAbi,
} from "./contracts";

/**
 * The primary offering, read from and written to the chain.
 *
 * The factory mints a note's whole supply to its issuer, so without an offering
 * nobody else can ever hold one. The issuer decides what share of the loan to
 * sell; the price follows from the note's own terms rather than being invented,
 * and an investor buys straight from the pool.
 *
 * Nothing here is escrowed. `buy` pays the seller in the same transaction that
 * delivers the tokens, so the desk never holds anyone's money between calls.
 */

export interface OfferState {
  seller: `0x${string}`;
  /** Currency units per whole token, or 0n when quoting at par. */
  priceOverride: bigint;
  open: boolean;
  /** Tokens currently for sale. Amortizes with the note. */
  available: bigint;
  /** What a buy would actually charge: the override, else par. */
  price: bigint;
  parPrice: bigint;
  /** The pool as a share of supply, in basis points. */
  poolBps: number;
  /** Settlement currency taken for this note so far. */
  raised: bigint;
}

export function useOffer(note?: `0x${string}`) {
  const desk = addresses.saleDesk;
  const enabled = Boolean(note && desk);
  const contract = { abi: saleDeskAbi, address: desk, chainId: CHAIN_ID } as const;

  const result = useReadContracts({
    contracts: [
      { ...contract, functionName: "offers", args: note ? [note] : undefined },
      { ...contract, functionName: "available", args: note ? [note] : undefined },
      { ...contract, functionName: "price", args: note ? [note] : undefined },
      { ...contract, functionName: "parPrice", args: note ? [note] : undefined },
      { ...contract, functionName: "poolBps", args: note ? [note] : undefined },
      { ...contract, functionName: "raised", args: note ? [note] : undefined },
    ],
    query: { enabled, refetchInterval: 15_000 },
  });

  const [offer, available, price, parPrice, poolBps, raised] = result.data ?? [];
  const tuple = offer?.result as
    | readonly [`0x${string}`, bigint, boolean]
    | undefined;

  return {
    ...result,
    offer: tuple
      ? ({
          seller: tuple[0],
          priceOverride: tuple[1],
          open: tuple[2],
          available: (available?.result as bigint) ?? 0n,
          price: (price?.result as bigint) ?? 0n,
          parPrice: (parPrice?.result as bigint) ?? 0n,
          poolBps: Number((poolBps?.result as bigint) ?? 0n),
          raised: (raised?.result as bigint) ?? 0n,
        } satisfies OfferState)
      : undefined,
  };
}

/** The issuer's allowance to the desk, which gates funding the pool. */
export function useNoteAllowance(note?: `0x${string}`, owner?: `0x${string}`) {
  return useReadContracts({
    contracts: [
      {
        abi: rwaNoteAbi,
        address: note,
        chainId: CHAIN_ID,
        functionName: "balanceOf",
        args: owner ? [owner] : undefined,
      },
    ],
    query: { enabled: Boolean(note && owner) },
  });
}

/**
 * Opening or topping up a pool: approve the note, then move it.
 *
 * The approval is for exactly the amount being placed. An unlimited one would
 * leave the desk able to move the issuer's whole holding long after the sale it
 * was granted for.
 */
export function useFundOffer(note?: `0x${string}`) {
  const approve = useWriteContract();
  const fund = useWriteContract();
  const approveReceipt = useWaitForTransactionReceipt({
    hash: approve.data,
    chainId: CHAIN_ID,
  });
  const fundReceipt = useWaitForTransactionReceipt({
    hash: fund.data,
    chainId: CHAIN_ID,
  });

  return {
    hash: fund.data,
    isApproving: approve.isPending || approveReceipt.isLoading,
    isFunding: fund.isPending || fundReceipt.isLoading,
    isDone: fundReceipt.isSuccess,
    error: approve.error ?? fund.error,

    /**
     * @param amount Tokens to place in the pool.
     * @param priceOverride Currency units per token, or 0n to quote at par.
     * @param alreadyOpen Whether an offer exists — the desk rejects a second
     *        `openOffer`, and `fundPool` rejects a note with no offer.
     */
    run: async (amount: bigint, priceOverride: bigint, alreadyOpen: boolean) => {
      if (!note || !addresses.saleDesk) {
        throw new Error("The sale desk address is not configured.");
      }

      if (amount > 0n) {
        await approve.writeContractAsync({
          abi: rwaNoteAbi,
          address: note,
          functionName: "approve",
          args: [addresses.saleDesk, amount],
          chainId: CHAIN_ID,
        });
      }

      return fund.writeContractAsync({
        abi: saleDeskAbi,
        address: addresses.saleDesk,
        functionName: alreadyOpen ? "fundPool" : "openOffer",
        args: alreadyOpen ? [note, amount] : [note, amount, priceOverride],
        chainId: CHAIN_ID,
      });
    },
  };
}

/**
 * Opens an offering for a note whose address is not known until it exists.
 *
 * `useFundOffer` binds the note when the hook runs, which is fine on a note's
 * own page. At issuance there is no note yet — the factory deploys it — so the
 * address arrives with the mint receipt and has to be passed to `run` instead.
 */
export function useOpenOfferFor() {
  const approve = useWriteContract();
  const open = useWriteContract();
  const approveReceipt = useWaitForTransactionReceipt({
    hash: approve.data,
    chainId: CHAIN_ID,
  });
  const openReceipt = useWaitForTransactionReceipt({
    hash: open.data,
    chainId: CHAIN_ID,
  });

  return {
    hash: open.data,
    isApproving: approve.isPending || approveReceipt.isLoading,
    isFunding: open.isPending || openReceipt.isLoading,
    error: approve.error ?? open.error,

    run: async (
      note: `0x${string}`,
      amount: bigint,
      priceOverride: bigint,
    ) => {
      if (!addresses.saleDesk) {
        throw new Error("The sale desk address is not configured.");
      }
      if (amount <= 0n) return undefined;

      await approve.writeContractAsync({
        abi: rwaNoteAbi,
        address: note,
        functionName: "approve",
        args: [addresses.saleDesk, amount],
        chainId: CHAIN_ID,
      });

      return open.writeContractAsync({
        abi: saleDeskAbi,
        address: addresses.saleDesk,
        functionName: "openOffer",
        args: [note, amount, priceOverride],
        chainId: CHAIN_ID,
      });
    },
  };
}

/** Takes unsold tokens back. Emptying the pool pauses a sale; it does not end it. */
export function useWithdrawPool(note?: `0x${string}`) {
  const { writeContractAsync, data: hash, isPending, error } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash, chainId: CHAIN_ID });

  return {
    hash,
    error,
    isPending: isPending || receipt.isLoading,
    isDone: receipt.isSuccess,
    withdraw: (amount: bigint) =>
      writeContractAsync({
        abi: saleDeskAbi,
        address: addresses.saleDesk!,
        functionName: "withdrawPool",
        args: [note!, amount],
        chainId: CHAIN_ID,
      }),
  };
}

/** Repoints the quote. Zero restores par. */
export function useSetPrice(note?: `0x${string}`) {
  const { writeContractAsync, data: hash, isPending, error } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash, chainId: CHAIN_ID });

  return {
    hash,
    error,
    isPending: isPending || receipt.isLoading,
    isDone: receipt.isSuccess,
    setPrice: (priceOverride: bigint) =>
      writeContractAsync({
        abi: saleDeskAbi,
        address: addresses.saleDesk!,
        functionName: "setPrice",
        args: [note!, priceOverride],
        chainId: CHAIN_ID,
      }),
  };
}

/** Ends the offering and returns whatever is unsold. */
export function useCloseOffer(note?: `0x${string}`) {
  const { writeContractAsync, data: hash, isPending, error } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash, chainId: CHAIN_ID });

  return {
    hash,
    error,
    isPending: isPending || receipt.isLoading,
    isDone: receipt.isSuccess,
    close: () =>
      writeContractAsync({
        abi: saleDeskAbi,
        address: addresses.saleDesk!,
        functionName: "closeOffer",
        args: [note!],
        chainId: CHAIN_ID,
      }),
  };
}

/**
 * Buying: approve the settlement currency, then take the tokens.
 *
 * `maxCost` is the buyer's protection. The desk reads the price at execution
 * rather than trusting a number the caller passes, which is right — but it also
 * means the issuer could reprice between the quote on screen and the moment the
 * transaction lands, and this is what stops that becoming the buyer's problem.
 */
export function useBuyFromOffer(note?: `0x${string}`) {
  const approve = useWriteContract();
  const buy = useWriteContract();
  const approveReceipt = useWaitForTransactionReceipt({
    hash: approve.data,
    chainId: CHAIN_ID,
  });
  const buyReceipt = useWaitForTransactionReceipt({
    hash: buy.data,
    chainId: CHAIN_ID,
  });

  return {
    hash: buy.data,
    isApproving: approve.isPending || approveReceipt.isLoading,
    isBuying: buy.isPending || buyReceipt.isLoading,
    isDone: buyReceipt.isSuccess,
    error: approve.error ?? buy.error,

    run: async (amount: bigint, maxCost: bigint) => {
      if (!note || !addresses.saleDesk || !addresses.usdg) {
        throw new Error("Contract addresses are not configured.");
      }

      await approve.writeContractAsync({
        abi: erc20Abi,
        address: addresses.usdg,
        functionName: "approve",
        args: [addresses.saleDesk, maxCost],
        chainId: CHAIN_ID,
      });

      return buy.writeContractAsync({
        abi: saleDeskAbi,
        address: addresses.saleDesk,
        functionName: "buy",
        args: [note, amount, maxCost],
        chainId: CHAIN_ID,
      });
    },
  };
}
