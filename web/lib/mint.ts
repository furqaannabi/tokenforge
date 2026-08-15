"use client";

import { useState } from "react";
import { usePublicClient, useWriteContract } from "wagmi";
import { decodeEventLog } from "viem";
import { CHAIN_ID, addresses, noteFactoryAbi } from "./contracts";
import { buildMintArgs } from "@tokenforge/core";
import type { ApiMintRequest } from "./api";
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
    /**
     * Signs a mint the admin already approved.
     *
     * Takes the parameters the service stored rather than rebuilding them.
     * `NoteFactory` recomputes their hash and refuses anything that is not
     * exactly what was cleared, so rebuilding here would turn a stale form
     * into an unexplained revert.
     */
    mintApproved: async (
      request: ApiMintRequest,
    ): Promise<MintResult> => {
      if (!addresses.noteFactory) {
        throw new Error("The note factory address is not configured.");
      }
      if (!publicClient) throw new Error(`No RPC client for chain ${CHAIN_ID}.`);

      const a = request.args;
      const args = {
        name: a.name,
        symbol: a.symbol,
        issuer: a.issuer,
        borrower: a.borrower,
        supply: BigInt(a.supply),
        currency: a.currency,
        gracePeriod: BigInt(a.gracePeriod),
        terms: {
          principal: BigInt(a.terms.principal),
          rateBps: a.terms.rateBps,
          maturity: BigInt(a.terms.maturity),
          documentHash: a.terms.documentHash,
          scheduleHash: a.terms.scheduleHash,
        },
        schedule: a.schedule.map((p) => ({
          dueDate: BigInt(p.dueDate),
          principal: BigInt(p.principal),
          interest: BigInt(p.interest),
        })),
      };

      try {
        setPhase("signing");
        const hash = await writeContractAsync({
          abi: noteFactoryAbi,
          address: addresses.noteFactory,
          functionName: "mintNote",
          /*
           * The borrower's signature travels with the mint.
           *
           * The factory recovers it against these exact parameters and opens
           * the note Active, so the borrower never sends a second transaction
           * to accept what they already signed. Absent one — an older request
           * taken before this existed — the note opens Pending and waits for
           * `accept`, exactly as before.
           */
          args: [args, (request.borrowerAccepted?.signature ?? "0x") as `0x${string}`],
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
          // No approval request here, so no signature: opens Pending.
          args: [args, "0x"],
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
