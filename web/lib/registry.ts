"use client";

import {
  usePublicClient,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import {
  CHAIN_ID,
  addresses,
  contractsConfigured,
  issuerRegistryAbi,
  issuerRegistryAddress,
} from "./contracts";

/**
 * Registry membership, read from the chain.
 *
 * `NoteFactory` reverts for any address `IssuerRegistry` does not recognise, so
 * the interface reads that same contract rather than keeping its own list. A
 * local allowlist would drift the moment an admin admitted someone, and would
 * drift in the direction that looks worst: showing a wallet as verified that
 * the chain would refuse.
 *
 * Admission is a write signed by the admin's own wallet. Nothing here goes
 * through a server, because a server that could admit issuers would become a
 * second registry and the on-chain one would stop being the answer.
 */

export function useIsRegisteredIssuer(address?: `0x${string}`) {
  const query = useReadContract({
    abi: issuerRegistryAbi,
    address: addresses.issuerRegistry,
    functionName: "isRegisteredIssuer",
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: Boolean(address && contractsConfigured) },
  });

  return {
    ...query,
    /** Never optimistic: unknown reads as not registered. */
    verified: query.data === true,
  };
}

/**
 * Whether the admin has cleared exactly these parameters for this issuer.
 *
 * The hash commits to every value the note will carry, so this answers "may
 * this exact mint proceed" rather than "is this company allowed to issue".
 */
export function useIsMintApproved(
  issuer?: `0x${string}`,
  mintHash?: `0x${string}`,
) {
  const query = useReadContract({
    abi: issuerRegistryAbi,
    address: addresses.issuerRegistry,
    functionName: "isMintApproved",
    args: issuer && mintHash ? [issuer, mintHash] : undefined,
    chainId: CHAIN_ID,
    query: {
      enabled: Boolean(issuer && mintHash && contractsConfigured),
      refetchInterval: 10_000,
    },
  });

  return { ...query, approved: query.data === true };
}

/** Whether an address may be named as a borrower. */
export function useIsRegisteredBorrower(address?: `0x${string}`) {
  const query = useReadContract({
    abi: issuerRegistryAbi,
    address: addresses.issuerRegistry,
    functionName: "isRegisteredBorrower",
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: Boolean(address && contractsConfigured) },
  });
  return { ...query, registered: query.data === true };
}

/** Admits a counterparty to borrow. A separate right from issuing. */
export function useAdmitBorrower() {
  const publicClient = usePublicClient({ chainId: CHAIN_ID });
  const { writeContractAsync, isPending, error } = useWriteContract();
  return {
    error,
    isPending,
    admit: async (
      borrower: `0x${string}`,
      name: string,
      jurisdiction: string,
    ) => {
      const hash = await writeContractAsync({
        abi: issuerRegistryAbi,
        address: issuerRegistryAddress(),
        functionName: "admitBorrower",
        args: [borrower, name, jurisdiction],
        chainId: CHAIN_ID,
      });
      // Mined before this resolves. Returning on broadcast leaves every
      // caller refreshing state the chain has not changed yet.
      await publicClient?.waitForTransactionReceipt({ hash });
      return hash;
    },
  };
}

/** The admin clears one exact mint. Signed by their own wallet, as admission is. */
export function useApproveMint() {
  const publicClient = usePublicClient({ chainId: CHAIN_ID });
  const { writeContractAsync, data: hash, isPending, error } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash, chainId: CHAIN_ID });

  return {
    hash,
    error,
    isSigning: isPending,
    isConfirming: receipt.isLoading,
    isConfirmed: receipt.isSuccess,
    approve: async (issuer: `0x${string}`, mintHash: `0x${string}`) => {
      const hash = await writeContractAsync({
        abi: issuerRegistryAbi,
        address: issuerRegistryAddress(),
        functionName: "approveMint",
        args: [issuer, mintHash],
        chainId: CHAIN_ID,
      });
      // Mined before this resolves. Returning on broadcast leaves every
      // caller refreshing state the chain has not changed yet.
      await publicClient?.waitForTransactionReceipt({ hash });
      return hash;
    },
  };
}

/** The address permitted to admit and revoke issuers. */
export function useRegistryAdmin() {
  return useReadContract({
    abi: issuerRegistryAbi,
    address: addresses.issuerRegistry,
    functionName: "admin",
    chainId: CHAIN_ID,
    query: { enabled: contractsConfigured },
  });
}

/** Whether the connected wallet is that admin. */
export function useIsRegistryAdmin(address?: `0x${string}`) {
  const { data: admin, ...rest } = useRegistryAdmin();
  return {
    ...rest,
    admin,
    isAdmin:
      Boolean(address) &&
      Boolean(admin) &&
      admin!.toLowerCase() === address!.toLowerCase(),
  };
}

/** On-chain record for an issuer: name, jurisdiction, admission timestamp. */
export function useIssuerInfo(address?: `0x${string}`) {
  return useReadContract({
    abi: issuerRegistryAbi,
    address: addresses.issuerRegistry,
    functionName: "issuerInfo",
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: Boolean(address && contractsConfigured) },
  });
}

/**
 * Admits an issuer, signed by the admin's wallet.
 *
 * Two steps that are easy to conflate: `writeContract` resolves when the wallet
 * has broadcast, `isConfirmed` when the chain has accepted. Recording the
 * admission off-chain before confirmation would mark an application approved on
 * the strength of a transaction that could still revert.
 */
export function useAdmitIssuer() {
  const publicClient = usePublicClient({ chainId: CHAIN_ID });
  const { writeContractAsync, data: hash, isPending, error } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash, chainId: CHAIN_ID });

  return {
    hash,
    error,
    isSigning: isPending,
    isConfirming: receipt.isLoading,
    isConfirmed: receipt.isSuccess,
    receipt: receipt.data,
    admit: async (issuer: `0x${string}`, name: string, jurisdiction: string) => {
      const hash = await writeContractAsync({
        abi: issuerRegistryAbi,
        address: addresses.issuerRegistry!,
        functionName: "admitIssuer",
        args: [issuer, name, jurisdiction],
        chainId: CHAIN_ID,
      });
      // Mined before this resolves. Returning on broadcast leaves every
      // caller refreshing state the chain has not changed yet.
      await publicClient?.waitForTransactionReceipt({ hash });
      return hash;
    },
  };
}

export function useRevokeIssuer() {
  const publicClient = usePublicClient({ chainId: CHAIN_ID });
  const { writeContractAsync, data: hash, isPending, error } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash, chainId: CHAIN_ID });

  return {
    hash,
    error,
    isSigning: isPending,
    isConfirming: receipt.isLoading,
    isConfirmed: receipt.isSuccess,
    revoke: async (issuer: `0x${string}`) => {
      const hash = await writeContractAsync({
        abi: issuerRegistryAbi,
        address: addresses.issuerRegistry!,
        functionName: "revokeIssuer",
        args: [issuer],
        chainId: CHAIN_ID,
      });
      // Mined before this resolves. Returning on broadcast leaves every
      // caller refreshing state the chain has not changed yet.
      await publicClient?.waitForTransactionReceipt({ hash });
      return hash;
    },
  };
}
