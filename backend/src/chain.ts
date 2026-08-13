import { createPublicClient, http } from "viem";
import { repaymentVaultAbi, rwaNoteAbi, saleDeskAbi } from "./abi";

/**
 * Reading the chain, for the assistant.
 *
 * Everything Zoya says about a live note has to come from here rather than
 * from the extraction. The two agree — the mint hashes the schedule and the
 * contract enforces it — but they answer different questions: the extraction
 * is what a model read off a PDF, and this is what the note will actually pay.
 * When those diverge, the chain is right, and an assistant quoting the wrong
 * one would be confidently wrong about money.
 */

const CHAIN_ID = Number(process.env.CHAIN_ID ?? 1952);
const RPC =
  process.env.XLAYER_TESTNET_RPC_URL ?? "https://xlayertestrpc.okx.com";

const chain = {
  id: CHAIN_ID,
  name: "X Layer testnet",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
} as const;

export const publicClient = createPublicClient({
  chain,
  transport: http(RPC),
});

/** 0 Active · 1 Impaired · 2 Matured · 3 Pending */
export const NOTE_STATUS = ["Active", "Impaired", "Matured", "Pending"] as const;

export interface NoteState {
  status: string;
  /** Face value of the loan, in the settlement currency's own decimals. */
  principal: string;
  principalRepaid: string;
  outstanding: string;
  /** Falls as principal is repaid. Shares do not. */
  totalSupply: string;
  totalShares: string;
  issuer: `0x${string}`;
  borrower: `0x${string}`;
}

export async function readNote(note: `0x${string}`): Promise<NoteState> {
  const contract = { abi: rwaNoteAbi, address: note } as const;

  const [status, principal, repaid, supply, shares, issuer, borrower] =
    await publicClient.multicall({
      contracts: [
        { ...contract, functionName: "status" },
        { ...contract, functionName: "principal" },
        { ...contract, functionName: "principalRepaid" },
        { ...contract, functionName: "totalSupply" },
        { ...contract, functionName: "totalShares" },
        { ...contract, functionName: "issuer" },
        { ...contract, functionName: "borrower" },
      ],
      allowFailure: false,
    });

  const principalValue = principal as bigint;
  const repaidValue = repaid as bigint;

  return {
    status: NOTE_STATUS[Number(status)] ?? "Unknown",
    principal: principalValue.toString(),
    principalRepaid: repaidValue.toString(),
    outstanding: (principalValue - repaidValue).toString(),
    totalSupply: (supply as bigint).toString(),
    totalShares: (shares as bigint).toString(),
    issuer: issuer as `0x${string}`,
    borrower: borrower as `0x${string}`,
  };
}

export interface Instalment {
  period: number;
  dueDate: string;
  principal: string;
  interest: string;
  total: string;
  settled: boolean;
}

/**
 * The vault's own schedule, with what has already been paid marked.
 *
 * Settled periods are flagged rather than dropped: an investor asking what a
 * note pays needs the ones still to come, but an issuer asking where they are
 * in the schedule needs to see the whole thing.
 */
export async function readSchedule(
  vault: `0x${string}`,
): Promise<{ nextPeriod: number; periods: Instalment[] }> {
  const contract = { abi: repaymentVaultAbi, address: vault } as const;

  const [count, next] = await publicClient.multicall({
    contracts: [
      { ...contract, functionName: "periodCount" },
      { ...contract, functionName: "nextPeriod" },
    ],
    allowFailure: false,
  });

  const periodCount = Number(count);
  const nextPeriod = Number(next);

  const raw = await publicClient.multicall({
    contracts: Array.from({ length: periodCount }, (_, index) => ({
      ...contract,
      functionName: "periodAt" as const,
      args: [BigInt(index)],
    })),
    allowFailure: false,
  });

  const periods = raw.map((entry, index) => {
    const period = entry as {
      dueDate: bigint;
      principal: bigint;
      interest: bigint;
    };
    return {
      period: index + 1,
      dueDate: new Date(Number(period.dueDate) * 1000)
        .toISOString()
        .slice(0, 10),
      principal: period.principal.toString(),
      interest: period.interest.toString(),
      total: (period.principal + period.interest).toString(),
      settled: index < nextPeriod,
    } satisfies Instalment;
  });

  return { nextPeriod, periods };
}

/** What is on offer, and what it costs. Zero when nothing is for sale. */
export async function readOffer(note: `0x${string}`) {
  const desk = process.env.SALE_DESK_ADDRESS as `0x${string}` | undefined;
  if (!desk) return null;

  const contract = { abi: saleDeskAbi, address: desk } as const;

  const [available, price, poolBps] = await publicClient.multicall({
    contracts: [
      { ...contract, functionName: "available", args: [note] },
      { ...contract, functionName: "price", args: [note] },
      { ...contract, functionName: "poolBps", args: [note] },
    ],
    allowFailure: false,
  });

  return {
    tokensAvailable: (available as bigint).toString(),
    pricePerToken: (price as bigint).toString(),
    shareOfNoteBps: Number(poolBps),
  };
}

/** A wallet's stake: what it is worth, what it owns, what it is owed. */
export async function readPosition(
  note: `0x${string}`,
  vault: `0x${string}`,
  holder: `0x${string}`,
) {
  const [balance, shares, claimable] = await publicClient.multicall({
    contracts: [
      { abi: rwaNoteAbi, address: note, functionName: "balanceOf", args: [holder] },
      { abi: rwaNoteAbi, address: note, functionName: "sharesOf", args: [holder] },
      {
        abi: repaymentVaultAbi,
        address: vault,
        functionName: "claimable",
        args: [holder],
      },
    ],
    allowFailure: false,
  });

  return {
    // Worth today. Falls as principal is repaid.
    balance: (balance as bigint).toString(),
    // Ownership. Unchanged by amortization, which is why both are reported.
    shares: (shares as bigint).toString(),
    claimable: (claimable as bigint).toString(),
  };
}
