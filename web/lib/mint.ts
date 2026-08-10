"use client";

import { useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { decodeEventLog } from "viem";
import { CHAIN_ID, addresses, noteFactoryAbi } from "./contracts";
import { buildMintArgs } from "./contracts/mint";
import type { Currency, ExtractedTerms } from "@tokenforge/core";

/**
 * Minting, signed by the issuer's own wallet.
 *
 * The service never sends this transaction. It holds no key, and the whole
 * claim of the product — that only registered issuers can create notes — rests
 * on `NoteFactory` checking the registry for the address that actually signed.
 * Routing it through a server would put a second, unregistered address in the
 * middle and quietly break that.
 */

export interface MintResult {
  hash: `0x${string}`;
  note: `0x${string}`;
  vault: `0x${string}`;
  blockNumber: bigint;
}

export function useMintNote() {
  const { writeContractAsync, data: hash, isPending, error, reset } =
    useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash, chainId: CHAIN_ID });

  /**
   * The note and vault addresses are not knowable before the transaction —
   * the factory creates both — so they are read back from the `NoteMinted`
   * event once it confirms.
   */
  const minted = extractMinted(receipt.data?.logs);

  return {
    hash,
    error,
    reset,
    isSigning: isPending,
    isConfirming: receipt.isLoading,
    isConfirmed: receipt.isSuccess,
    result:
      minted && receipt.data
        ? {
            hash: receipt.data.transactionHash,
            note: minted.note,
            vault: minted.vault,
            blockNumber: receipt.data.blockNumber,
          }
        : undefined,

    mint: (input: {
      terms: ExtractedTerms;
      name: string;
      symbol: string;
      issuer: `0x${string}`;
      currency: Currency;
      documentHash: `0x${string}`;
      supplyTokens: number;
    }) => {
      if (!addresses.noteFactory || !addresses.usdg) {
        throw new Error(
          "Contract addresses are not configured. See contracts/deployments/xlayer-testnet.json.",
        );
      }

      const args = buildMintArgs({ ...input, currencyAddress: addresses.usdg });

      return writeContractAsync({
        abi: noteFactoryAbi,
        address: addresses.noteFactory,
        functionName: "mintNote",
        args: [args],
        chainId: CHAIN_ID,
      });
    },
  };
}

function extractMinted(logs?: readonly { data: `0x${string}`; topics: readonly `0x${string}`[] }[]) {
  if (!logs) return undefined;

  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: noteFactoryAbi,
        data: log.data,
        topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
      });
      if (decoded.eventName === "NoteMinted") {
        const args = decoded.args as unknown as {
          note: `0x${string}`;
          vault: `0x${string}`;
        };
        return { note: args.note, vault: args.vault };
      }
    } catch {
      // Logs from the note and vault deployments sit in the same receipt and
      // do not decode against this ABI. Skipping them is expected.
    }
  }
  return undefined;
}
