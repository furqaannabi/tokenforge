"use client";

import { useState } from "react";
import { usePublicClient, useWriteContract } from "wagmi";
import { decodeEventLog } from "viem";
import { CHAIN_ID, addresses, noteFactoryAbi } from "./contracts";
import { buildMintArgs } from "@tokenforge/core";
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
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: CHAIN_ID });

  const [phase, setPhase] = useState<"idle" | "signing" | "confirming">("idle");

  return {
    isSigning: phase === "signing",
    isConfirming: phase === "confirming",

    /**
     * Signs, waits, and returns what the chain created.
     *
     * Deliberately resolves on confirmation rather than on broadcast. The note
     * and vault addresses are not knowable beforehand — the factory deploys
     * both — so they are read out of the `NoteMinted` event. An earlier version
     * returned the hash immediately, which meant the caller had nothing to
     * record and the mint never reached the service at all.
     */
    mint: async (input: {
      terms: ExtractedTerms;
      name: string;
      symbol: string;
      issuer: `0x${string}`;
      borrower: `0x${string}`;
      currency: Currency;
      documentHash: `0x${string}`;
      supplyTokens: number;
    }): Promise<MintResult> => {
      if (!addresses.noteFactory || !addresses.usdg) {
        throw new Error(
          "Contract addresses are not configured. See contracts/deployments/xlayer-testnet.json.",
        );
      }
      if (!publicClient) {
        throw new Error(`No RPC client for chain ${CHAIN_ID}.`);
      }

      const args = buildMintArgs({ ...input, currencyAddress: addresses.usdg });

      try {
        setPhase("signing");
        const hash = await writeContractAsync({
          abi: noteFactoryAbi,
          address: addresses.noteFactory,
          functionName: "mintNote",
          args: [args],
          chainId: CHAIN_ID,
        });

        setPhase("confirming");
        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        if (receipt.status !== "success") {
          throw new Error("The mint transaction reverted.");
        }

        const minted = findNoteMinted(receipt.logs);
        if (!minted) {
          throw new Error(
            "The transaction confirmed but emitted no NoteMinted event.",
          );
        }

        return {
          hash,
          note: minted.note,
          vault: minted.vault,
          blockNumber: receipt.blockNumber,
        };
      } finally {
        setPhase("idle");
      }
    },
  };
}

function findNoteMinted(
  logs: readonly { data: `0x${string}`; topics: readonly `0x${string}`[] }[],
) {
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
      // The note and vault deployments log into the same receipt and do not
      // decode against this ABI. Skipping them is expected.
    }
  }
  return undefined;
}
