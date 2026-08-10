"use client";

import { useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import {
  CHAIN_ID,
  addresses,
  contractsConfigured,
  issuerRegistryAbi,
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
  const { writeContractAsync, data: hash, isPending, error } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash, chainId: CHAIN_ID });

  return {
    hash,
    error,
    isSigning: isPending,
    isConfirming: receipt.isLoading,
    isConfirmed: receipt.isSuccess,
    receipt: receipt.data,
    admit: (issuer: `0x${string}`, name: string, jurisdiction: string) =>
      writeContractAsync({
        abi: issuerRegistryAbi,
        address: addresses.issuerRegistry!,
        functionName: "admitIssuer",
        args: [issuer, name, jurisdiction],
        chainId: CHAIN_ID,
      }),
  };
}

export function useRevokeIssuer() {
  const { writeContractAsync, data: hash, isPending, error } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash, chainId: CHAIN_ID });

  return {
    hash,
    error,
    isSigning: isPending,
    isConfirming: receipt.isLoading,
    isConfirmed: receipt.isSuccess,
    revoke: (issuer: `0x${string}`) =>
      writeContractAsync({
        abi: issuerRegistryAbi,
        address: addresses.issuerRegistry!,
        functionName: "revokeIssuer",
        args: [issuer],
        chainId: CHAIN_ID,
      }),
  };
}
