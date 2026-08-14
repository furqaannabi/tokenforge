import { createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { xLayerTestnet } from "viem/chains";
import { publicClient } from "./chain";
import { repaymentVaultAbi } from "./abi";
import { prisma } from "./db";

/**
 * The keeper: the thing that wakes a contract up.
 *
 * `collectFromBorrower` pulls a due instalment from the borrower against a
 * standing allowance they granted. A contract cannot call itself on a
 * schedule, so something off-chain has to, and this is it — a cron sweep that
 * asks each vault whether a collection would succeed and makes the ones that
 * would.
 *
 * WHY A HOT KEY IS ACCEPTABLE HERE, which is the only interesting question:
 * this key cannot move anyone's money. `collectFromBorrower` takes no
 * arguments and no recipient; it moves exactly the scheduled amount, from the
 * borrower named by the note, into the vault, and only once the due date has
 * passed and only as far as the borrower's own allowance permits. Whoever
 * holds this key can pay other people's debts on time. That is the whole
 * privilege. A leak costs gas, not funds.
 *
 * Which is also why the call is unpermissioned in the contract. Restricting it
 * to a keeper role would put one key between a borrower and their own
 * repayment record, and buy nothing: the call is already incapable of harm.
 */

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

export interface CollectionAttempt {
  note: string;
  vault: string;
  extractionId: string;
  outcome: "collected" | "failed";
  hash?: string;
  error?: string;
  at: string;
}

interface KeeperStatus {
  enabled: boolean;
  address?: string;
  intervalMs: number;
  running: boolean;
  lastRunAt?: string;
  lastRunChecked?: number;
  lastError?: string;
  /** Most recent attempts, newest first. Bounded — this is a status page, not a ledger. */
  recent: CollectionAttempt[];
}

const status: KeeperStatus = {
  enabled: false,
  intervalMs: Number(process.env.KEEPER_INTERVAL_MS ?? DEFAULT_INTERVAL_MS),
  running: false,
  recent: [],
};

export function keeperStatus(): KeeperStatus {
  return status;
}

function keeperAccount() {
  const key = process.env.KEEPER_PRIVATE_KEY;
  if (!key) return undefined;
  return privateKeyToAccount(
    (key.startsWith("0x") ? key : `0x${key}`) as Hex,
  );
}

/**
 * One pass over every minted note.
 *
 * Exported so the cron and the manual trigger run identical code — an
 * automation that behaves differently when you test it by hand is one you
 * have not tested.
 */
export async function sweep(): Promise<CollectionAttempt[]> {
  const account = keeperAccount();
  if (!account) return [];

  // Overlapping sweeps would send two transactions from one account with the
  // same nonce, and the second would be rejected.
  if (status.running) return [];
  status.running = true;

  const attempts: CollectionAttempt[] = [];

  try {
    const notes = await prisma.extraction.findMany({
      where: { status: "MINTED" },
      include: { note: true },
      take: 200,
    });

    const vaults = notes
      .filter((row) => row.note)
      .map((row) => ({
        extractionId: row.id,
        note: row.note!.noteAddress as `0x${string}`,
        vault: row.note!.vaultAddress as `0x${string}`,
      }));

    status.lastRunChecked = vaults.length;
    if (vaults.length === 0) return [];

    /*
     * One batched read for the whole set, then transactions only for the ones
     * that need one. `collectible` is the contract's own answer, so the keeper
     * never reimplements the due-date, allowance and balance tests and gets
     * them subtly out of step with the vault.
     */
    const collectible = await publicClient.multicall({
      contracts: vaults.map((entry) => ({
        abi: repaymentVaultAbi,
        address: entry.vault,
        functionName: "collectible",
      })),
    });

    const wallet = createWalletClient({
      account,
      chain: xLayerTestnet,
      transport: http(
        process.env.XLAYER_TESTNET_RPC_URL ?? "https://xlayertestrpc.okx.com",
      ),
    });

    for (const [index, entry] of vaults.entries()) {
      if (collectible[index]?.result !== true) continue;

      /*
       * Serial, and each receipt awaited before the next send. Firing these
       * concurrently from one account races on the nonce, and the losing
       * transaction is dropped silently — a payment that looks collected in
       * the logs and never landed.
       */
      try {
        const hash = await wallet.writeContract({
          abi: repaymentVaultAbi,
          address: entry.vault,
          functionName: "collectFromBorrower",
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        attempts.push({
          note: entry.note,
          vault: entry.vault,
          extractionId: entry.extractionId,
          outcome: receipt.status === "success" ? "collected" : "failed",
          hash,
          error:
            receipt.status === "success" ? undefined : "Transaction reverted.",
          at: new Date().toISOString(),
        });
      } catch (cause) {
        /*
         * One vault failing must not end the sweep. The common cause is
         * benign and expected — the borrower revoked the allowance or spent
         * the balance between the read and the send — and the other notes due
         * today are owed their collection regardless.
         */
        attempts.push({
          note: entry.note,
          vault: entry.vault,
          extractionId: entry.extractionId,
          outcome: "failed",
          error: (cause as Error).message.split("\n")[0],
          at: new Date().toISOString(),
        });
      }
    }

    status.lastError = undefined;
    return attempts;
  } catch (cause) {
    status.lastError = (cause as Error).message;
    return attempts;
  } finally {
    status.running = false;
    status.lastRunAt = new Date().toISOString();
    status.recent = [...attempts, ...status.recent].slice(0, 25);
  }
}

/**
 * Starts the sweep on an interval.
 *
 * Absent a key the keeper simply does not run, and says so on its status
 * endpoint. Failing loudly at boot would take the whole service down over an
 * optional convenience, and every collection remains available by hand from
 * the note page — the call is unpermissioned precisely so that automation is
 * never the only route.
 */
export function startKeeper(): void {
  const account = keeperAccount();
  if (!account) {
    console.info(
      "[keeper] KEEPER_PRIVATE_KEY is not set — automatic collection is off. Repayment still works by hand.",
    );
    return;
  }

  status.enabled = true;
  status.address = account.address;

  console.info(
    `[keeper] collecting due instalments every ${Math.round(
      status.intervalMs / 1000,
    )}s as ${account.address}`,
  );

  const tick = () => {
    void sweep()
      .then((attempts) => {
        for (const attempt of attempts) {
          console.info(
            `[keeper] ${attempt.outcome} ${attempt.vault} ${
              attempt.hash ?? attempt.error ?? ""
            }`,
          );
        }
      })
      .catch((cause) => {
        // Never let a rejection escape the timer: an unhandled one takes the
        // process down and stops every future collection.
        status.lastError = (cause as Error).message;
      });
  };

  // A first pass shortly after boot rather than a full interval of silence,
  // but not instantly — the database and RPC are still warming up.
  setTimeout(tick, 15_000);
  setInterval(tick, status.intervalMs).unref?.();
}
