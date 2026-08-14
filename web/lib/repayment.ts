"use client";

import {
  usePublicClient,
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
 * The standing authorization, and whether it is enough.
 *
 * Automatic repayment is an ERC-20 allowance and nothing more. The vault pulls
 * the instalment from the borrower once it is due; the borrower's control is
 * the allowance itself, which they can revoke at any moment. There is no
 * subscription to cancel and nobody to ask.
 *
 * `collectible` is the contract's own answer to "would a collection succeed
 * right now", so the panel never has to reimplement that test and get it
 * subtly wrong.
 */
export function useAutopay(vault?: `0x${string}`) {
  const reads = useReadContracts({
    contracts: vault
      ? [
          {
            abi: repaymentVaultAbi,
            address: vault,
            chainId: CHAIN_ID,
            functionName: "authorizedAmount",
          },
          {
            abi: repaymentVaultAbi,
            address: vault,
            chainId: CHAIN_ID,
            functionName: "collectible",
          },
          {
            abi: repaymentVaultAbi,
            address: vault,
            chainId: CHAIN_ID,
            functionName: "outstanding",
          },
          {
            abi: repaymentVaultAbi,
            address: vault,
            chainId: CHAIN_ID,
            functionName: "isOverdue",
          },
        ]
      : [],
    query: { enabled: Boolean(vault), refetchInterval: 15_000 },
  });

  const at = (index: number) => reads.data?.[index]?.result;

  return {
    /** What the borrower has authorised the vault to pull. */
    authorized: (at(0) as bigint | undefined) ?? 0n,
    /** The contract's own answer: would a collection succeed this second. */
    collectible: Boolean(at(1)),
    /** Everything still owed across unsettled periods. */
    outstanding: (at(2) as bigint | undefined) ?? 0n,
    /** Due date passed and still unpaid. */
    overdue: Boolean(at(3)),
    isPending: reads.isPending,
    refetch: reads.refetch,
  };
}

/**
 * Grants or revokes the vault's standing permission to collect.
 *
 * Revoking is the same call with zero, which is the point worth making in the
 * interface: the borrower is not asking anyone's permission to stop.
 */
export function useAuthorizeAutopay(vault?: `0x${string}`) {
  const publicClient = usePublicClient({ chainId: CHAIN_ID });
  const approve = useWriteContract();
  const receipt = useWaitForTransactionReceipt({
    hash: approve.data,
    chainId: CHAIN_ID,
  });

  return {
    isSigning: approve.isPending,
    isConfirming: receipt.isLoading,
    error: approve.error,

    authorize: async (amount: bigint) => {
      if (!vault || !addresses.usdg) {
        throw new Error("Contract addresses are not configured.");
      }

      const hash = await approve.writeContractAsync({
        abi: erc20Abi,
        address: addresses.usdg,
        functionName: "approve",
        args: [vault, amount],
        chainId: CHAIN_ID,
      });

      // Mined before this resolves: an authorization the caller cannot yet see
      // on-chain reads to them as one that did not happen.
      await publicClient?.waitForTransactionReceipt({ hash });
      return hash;
    },
  };
}

/**
 * Triggers a due collection now, from any wallet.
 *
 * `collectFromBorrower` is deliberately unpermissioned — a contract cannot
 * wake itself up. The keeper normally makes this call; the button exists
 * because an automation nobody can run by hand is one nobody can verify.
 */
export function useCollectNow(vault?: `0x${string}`) {
  const publicClient = usePublicClient({ chainId: CHAIN_ID });
  const collect = useWriteContract();
  const receipt = useWaitForTransactionReceipt({
    hash: collect.data,
    chainId: CHAIN_ID,
  });

  return {
    isSigning: collect.isPending,
    isConfirming: receipt.isLoading,
    error: collect.error,

    collect: async () => {
      if (!vault) throw new Error("Contract addresses are not configured.");

      const hash = await collect.writeContractAsync({
        abi: repaymentVaultAbi,
        address: vault,
        functionName: "collectFromBorrower",
        chainId: CHAIN_ID,
      });

      await publicClient?.waitForTransactionReceipt({ hash });
      return hash;
    },
  };
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
  const publicClient = usePublicClient({ chainId: CHAIN_ID });
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
        const approvalHash = await approve.writeContractAsync({
          abi: erc20Abi,
          address: addresses.usdg,
          functionName: "approve",
          args: [vault, amount],
          chainId: CHAIN_ID,
        });

        // Mined before the pull, or `settleNextPeriod` runs its transferFrom
        // against an allowance that has not landed yet.
        await publicClient?.waitForTransactionReceipt({ hash: approvalHash });
      }

      const settleHash = await settle.writeContractAsync({
        abi: repaymentVaultAbi,
        address: vault,
        functionName: "settleNextPeriod",
        chainId: CHAIN_ID,
      });

      // Mined before this resolves, or the caller refreshes balances that have
      // not moved yet.
      await publicClient?.waitForTransactionReceipt({ hash: settleHash });
      return settleHash;
    },
  };
}

/** Takes a holder's share of everything paid in so far. */
export function useClaim(vault?: `0x${string}`) {
  const publicClient = usePublicClient({ chainId: CHAIN_ID });
  const { writeContractAsync, data: hash, isPending, error } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash, chainId: CHAIN_ID });

  return {
    hash,
    error,
    isSigning: isPending,
    isConfirming: receipt.isLoading,
    isConfirmed: receipt.isSuccess,
    claim: async () => {
      const hash = await writeContractAsync({
        abi: repaymentVaultAbi,
        address: vault!,
        functionName: "claim",
        chainId: CHAIN_ID,
      });
      // Same reason as everywhere else: a claim that resolves on broadcast
      // leaves the screen showing the money as still unclaimed.
      await publicClient?.waitForTransactionReceipt({ hash });
      return hash;
    },
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
  const publicClient = usePublicClient({ chainId: CHAIN_ID });
  const { writeContractAsync, data: hash, isPending, error } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash, chainId: CHAIN_ID });

  return {
    hash,
    error,
    isSigning: isPending,
    isConfirming: receipt.isLoading,
    isConfirmed: receipt.isSuccess,
    accept: async () => {
      const hash = await writeContractAsync({
        abi: rwaNoteAbi,
        address: note!,
        functionName: "accept",
        chainId: CHAIN_ID,
      });
      // Mined before this resolves. Returning on broadcast leaves every
      // caller refreshing state the chain has not changed yet.
      await publicClient?.waitForTransactionReceipt({ hash });
      return hash;
    },
  };
}

/**
 * Mints test currency to the caller.
 *
 * Only meaningful against the testnet mock, whose `mint` is unrestricted. It
 * exists so a demo can fund a repayment without a faucet round trip.
 */
export function useMintTestCurrency() {
  const publicClient = usePublicClient({ chainId: CHAIN_ID });
  const { writeContractAsync, data: hash, isPending } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash, chainId: CHAIN_ID });

  return {
    hash,
    isPending: isPending || receipt.isLoading,
    isConfirmed: receipt.isSuccess,
    mint: async (to: `0x${string}`, amount: bigint) => {
      const hash = await writeContractAsync({
        abi: erc20Abi,
        address: addresses.usdg!,
        functionName: "mint",
        args: [to, amount],
        chainId: CHAIN_ID,
      });
      // Mined before this resolves. Returning on broadcast leaves every
      // caller refreshing state the chain has not changed yet.
      await publicClient?.waitForTransactionReceipt({ hash });
      return hash;
    },
  };
}

export { query };
