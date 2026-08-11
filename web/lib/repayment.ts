"use client";

import {
  useReadContract,
  useReadContracts,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import {
  CHAIN_ID,
  addresses,
  erc20Abi,
  repaymentVaultAbi,
  rwaNoteAbi,
} from "./contracts";

/**
 * The repayment lifecycle, read from and written to the chain.
 *
 * Two actions, and they belong to different people. The issuer settles a
 * period, which pulls the payment and amortizes every holder's balance in one
 * transaction. A holder claims their share of what has been paid in, whenever
 * they like. Neither goes through a server.
 */

const query = { enabled: true } as const;

export interface NoteState {
  /** What a share is worth today, scaled 1e18. Zero once fully repaid. */
  principalIndex: bigint;
  principalRepaid: bigint;
  principal: bigint;
  totalSupply: bigint;
  totalShares: bigint;
  /** 0 Active · 1 Impaired · 2 Matured */
  status: number;
  /** Who originated the loan and sells it on. */
  issuer: `0x${string}`;
  /**
   * Who owes the money. Zero for notes from factories that predate the role,
   * which had no borrower and were Active from mint.
   */
  borrower: `0x${string}`;
}

/** Live note state. Balances here already reflect amortization. */
export function useNoteState(note?: `0x${string}`) {
  const contract = { abi: rwaNoteAbi, address: note, chainId: CHAIN_ID } as const;

  const result = useReadContracts({
    contracts: [
      { ...contract, functionName: "principalIndex" },
      { ...contract, functionName: "principalRepaid" },
      { ...contract, functionName: "principal" },
      { ...contract, functionName: "totalSupply" },
      { ...contract, functionName: "totalShares" },
      { ...contract, functionName: "status" },
      { ...contract, functionName: "issuer" },
      { ...contract, functionName: "borrower" },
    ],
    query: { enabled: Boolean(note) },
  });

  const [index, repaid, principal, supply, shares, status, issuer, borrower] =
    result.data ?? [];

  return {
    ...result,
    state: result.data
      ? ({
          principalIndex: (index?.result as bigint) ?? 0n,
          principalRepaid: (repaid?.result as bigint) ?? 0n,
          principal: (principal?.result as bigint) ?? 0n,
          totalSupply: (supply?.result as bigint) ?? 0n,
          totalShares: (shares?.result as bigint) ?? 0n,
          status: Number(status?.result ?? 0),
          issuer: (issuer?.result as `0x${string}`) ?? "0x",
          borrower:
            (borrower?.result as `0x${string}`) ??
            "0x0000000000000000000000000000000000000000",
        } satisfies NoteState)
      : undefined,
  };
}

/** A holder's position: what it is worth now, and what it has earned. */
export function useHolderPosition(
  note?: `0x${string}`,
  vault?: `0x${string}`,
  holder?: `0x${string}`,
) {
  const enabled = Boolean(note && vault && holder);

  const result = useReadContracts({
    contracts: [
      {
        abi: rwaNoteAbi,
        address: note,
        chainId: CHAIN_ID,
        functionName: "balanceOf",
        args: holder ? [holder] : undefined,
      },
      {
        abi: rwaNoteAbi,
        address: note,
        chainId: CHAIN_ID,
        functionName: "sharesOf",
        args: holder ? [holder] : undefined,
      },
      {
        abi: repaymentVaultAbi,
        address: vault,
        chainId: CHAIN_ID,
        functionName: "claimable",
        args: holder ? [holder] : undefined,
      },
    ],
    query: { enabled },
  });

  const [balance, shares, claimable] = result.data ?? [];

  return {
    ...result,
    /** Worth today — falls as principal is repaid. */
    balance: (balance?.result as bigint) ?? 0n,
    /** Ownership — unchanged by amortization. */
    shares: (shares?.result as bigint) ?? 0n,
    claimable: (claimable?.result as bigint) ?? 0n,
  };
}

/**
 * Every period, read from the vault.
 *
 * The extraction has a schedule too, but that one is what a model read off a
 * PDF. This is what the note will actually pay, and the two are only equal
 * because the mint hashed the schedule and the contract enforces it — so when
 * the question is "what would I receive", the chain is the place to ask.
 */
export function useSchedule(vault?: `0x${string}`, periodCount = 0) {
  const contracts = Array.from({ length: periodCount }, (_, index) => ({
    abi: repaymentVaultAbi,
    address: vault,
    chainId: CHAIN_ID,
    functionName: "periodAt" as const,
    args: [BigInt(index)],
  }));

  const result = useReadContracts({
    contracts,
    query: { enabled: Boolean(vault) && periodCount > 0 },
  });

  return {
    ...result,
    periods: (result.data ?? []).map(
      (entry) =>
        entry.result as
          | { dueDate: bigint; principal: bigint; interest: bigint }
          | undefined,
    ),
  };
}

/** Where the schedule has got to. */
export function useVaultProgress(vault?: `0x${string}`) {
  const contract = {
    abi: repaymentVaultAbi,
    address: vault,
    chainId: CHAIN_ID,
  } as const;

  const result = useReadContracts({
    contracts: [
      { ...contract, functionName: "nextPeriod" },
      { ...contract, functionName: "periodCount" },
      { ...contract, functionName: "outstanding" },
      { ...contract, functionName: "totalDeposited" },
      { ...contract, functionName: "isOverdue" },
    ],
    query: { enabled: Boolean(vault) },
  });

  const [next, count, outstanding, deposited, overdue] = result.data ?? [];

  return {
    ...result,
    nextPeriod: Number(next?.result ?? 0),
    periodCount: Number(count?.result ?? 0),
    outstanding: (outstanding?.result as bigint) ?? 0n,
    totalDeposited: (deposited?.result as bigint) ?? 0n,
    isOverdue: Boolean(overdue?.result),
  };
}

/** The amount the next period will pull, so it can be approved first. */
export function useNextPeriodDue(vault?: `0x${string}`, index?: number) {
  return useReadContract({
    abi: repaymentVaultAbi,
    address: vault,
    chainId: CHAIN_ID,
    functionName: "periodAt",
    args: index !== undefined ? [BigInt(index)] : undefined,
    query: { enabled: Boolean(vault) && index !== undefined },
  });
}

/** How much the vault is already allowed to pull. */
export function useAllowance(owner?: `0x${string}`, spender?: `0x${string}`) {
  return useReadContract({
    abi: erc20Abi,
    address: addresses.usdg,
    chainId: CHAIN_ID,
    functionName: "allowance",
    args: owner && spender ? [owner, spender] : undefined,
    query: { enabled: Boolean(owner && spender && addresses.usdg) },
  });
}

/**
 * Settles the next period: approve, then pay.
 *
 * Two transactions, because ERC-20 has no way to pull without a prior
 * allowance. The approval is for exactly this period's amount rather than an
 * unlimited one — the vault has no reason to keep spending rights over the
 * issuer's balance after the payment it was granted for.
 */
export function useSettlePeriod(vault?: `0x${string}`) {
  const approve = useWriteContract();
  const settle = useWriteContract();
  const approveReceipt = useWaitForTransactionReceipt({
    hash: approve.data,
    chainId: CHAIN_ID,
  });
  const settleReceipt = useWaitForTransactionReceipt({
    hash: settle.data,
    chainId: CHAIN_ID,
  });

  return {
    approveHash: approve.data,
    settleHash: settle.data,
    isApproving: approve.isPending || approveReceipt.isLoading,
    isSettling: settle.isPending || settleReceipt.isLoading,
    isSettled: settleReceipt.isSuccess,
    error: approve.error ?? settle.error,

    run: async (amount: bigint, currentAllowance: bigint) => {
      if (!vault || !addresses.usdg) {
        throw new Error("Contract addresses are not configured.");
      }

      if (currentAllowance < amount) {
        await approve.writeContractAsync({
          abi: erc20Abi,
          address: addresses.usdg,
          functionName: "approve",
          args: [vault, amount],
          chainId: CHAIN_ID,
        });
      }

      return settle.writeContractAsync({
        abi: repaymentVaultAbi,
        address: vault,
        functionName: "settleNextPeriod",
        chainId: CHAIN_ID,
      });
    },
  };
}

/** Takes a holder's share of everything paid in so far. */
export function useClaim(vault?: `0x${string}`) {
  const { writeContractAsync, data: hash, isPending, error } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash, chainId: CHAIN_ID });

  return {
    hash,
    error,
    isSigning: isPending,
    isConfirming: receipt.isLoading,
    isConfirmed: receipt.isSuccess,
    claim: () =>
      writeContractAsync({
        abi: repaymentVaultAbi,
        address: vault!,
        functionName: "claim",
        chainId: CHAIN_ID,
      }),
  };
}

/**
 * The borrower affirms the terms.
 *
 * Until this lands the note is Pending: it cannot be transferred, offered, or
 * repaid. Only the named borrower's own key can call it — the issuer minting a
 * note is an assertion about someone else, and this is what turns it into a
 * debt that party acknowledged.
 */
export function useAcceptNote(note?: `0x${string}`) {
  const { writeContractAsync, data: hash, isPending, error } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash, chainId: CHAIN_ID });

  return {
    hash,
    error,
    isSigning: isPending,
    isConfirming: receipt.isLoading,
    isConfirmed: receipt.isSuccess,
    accept: () =>
      writeContractAsync({
        abi: rwaNoteAbi,
        address: note!,
        functionName: "accept",
        chainId: CHAIN_ID,
      }),
  };
}

/**
 * Mints test currency to the caller.
 *
 * Only meaningful against the testnet mock, whose `mint` is unrestricted. It
 * exists so a demo can fund a repayment without a faucet round trip.
 */
export function useMintTestCurrency() {
  const { writeContractAsync, data: hash, isPending } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash, chainId: CHAIN_ID });

  return {
    hash,
    isPending: isPending || receipt.isLoading,
    isConfirmed: receipt.isSuccess,
    mint: (to: `0x${string}`, amount: bigint) =>
      writeContractAsync({
        abi: erc20Abi,
        address: addresses.usdg!,
        functionName: "mint",
        args: [to, amount],
        chainId: CHAIN_ID,
      }),
  };
}

export { query };
