import { createPublicClient, formatUnits, http, parseUnits } from "viem";
import { xLayerTestnet } from "viem/chains";
import { CURRENCY_DECIMALS, ceilDiv, quoteOffer } from "@tokenforge/core";
import {
  issuerRegistryAbi,
  repaymentVaultAbi,
  rwaNoteAbi,
  saleDeskAbi,
} from "./abi";

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

const RPC =
  process.env.XLAYER_TESTNET_RPC_URL ?? "https://xlayertestrpc.okx.com";

/*
 * viem's own definition rather than a hand-rolled one.
 *
 * A literal with just an id, a name and an RPC looks sufficient and is not: it
 * carries no `multicall3` address, and every batched read here fails with
 * "Chain does not support contract multicall3". That failure stayed hidden
 * because nothing had been minted to read, so the first thing it broke was a
 * check running in the background with its error swallowed.
 */
export const publicClient = createPublicClient({
  chain: xLayerTestnet,
  transport: http(RPC),
});

/**
 * Who the registry says an address is.
 *
 * The name a party is admitted under is the only thing that can be compared
 * against a document — an address means nothing to an agreement, and a company
 * name means nothing to the chain. This is the join between them, and it is
 * read from the registry rather than taken from the browser, because the check
 * is precisely whether the party is who they say they are.
 */
export async function readParty(
  address: `0x${string}`,
): Promise<{ name: string; jurisdiction: string; registered: boolean } | null> {
  const registry = process.env.ISSUER_REGISTRY_ADDRESS as
    | `0x${string}`
    | undefined;
  if (!registry) return null;

  const [issuer, borrower] = await publicClient.multicall({
    contracts: [
      {
        abi: issuerRegistryAbi,
        address: registry,
        functionName: "issuerInfo",
        args: [address],
      },
      {
        abi: issuerRegistryAbi,
        address: registry,
        functionName: "borrowerInfo",
        args: [address],
      },
    ],
    allowFailure: true,
  });

  for (const entry of [issuer, borrower]) {
    if (entry.status !== "success") continue;
    const record = entry.result as {
      name: string;
      jurisdiction: string;
      registered: boolean;
    };
    if (record.registered) return record;
  }
  return null;
}

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
export async function readOffer(note: `0x${string}`, budget?: number) {
  const desk = process.env.SALE_DESK_ADDRESS as `0x${string}` | undefined;
  if (!desk) return null;

  const contract = { abi: saleDeskAbi, address: desk } as const;

  // USDG is the only settlement currency issued so far, and its decimals are
  // what every figure below is scaled by. Named rather than assumed as 18,
  // which is the mistake that made a 1,500 price read as 1.50.
  const currency = "USDG" as const;
  const decimals = CURRENCY_DECIMALS[currency];

  const [available, price, poolBps] = await publicClient.multicall({
    contracts: [
      { ...contract, functionName: "available", args: [note] },
      { ...contract, functionName: "price", args: [note] },
      { ...contract, functionName: "poolBps", args: [note] },
    ],
    allowFailure: false,
  });

  /*
   * Scaled here, and quoted here, rather than handed over raw.
   *
   * These come off the chain as bigints in two different bases — the note
   * ledger is 18-decimal, the price is in the settlement currency's — and
   * returning them as strings asked the model to know that and divide. It did
   * not: it read a price of 1,500 USDG as 1.50, and when asked what a budget
   * would buy it divided by the price and answered 3,333 tokens out of a pool
   * holding 321. Both are arithmetic, both have one right answer, and neither
   * is work a language model should be doing.
   *
   * `budget` is optional because most questions are "what is on offer". When
   * it is given, the sums below are the same ones `SaleDesk.quote` performs,
   * including which way each rounds, so the figure quoted is the figure
   * charged.
   */
  const availableRaw = available as bigint;
  const priceRaw = price as bigint;

  const offer = {
    tokensAvailable: Number(formatUnits(availableRaw, 18)),
    pricePerToken: Number(formatUnits(priceRaw, decimals)),
    shareOfNoteOfferedPct: Number(poolBps) / 100,
    currency,
    /** Everything on offer, at this price, before the buyer's fee. */
    wholePoolCost: Number(
      formatUnits(ceilDiv(availableRaw * priceRaw, 10n ** 18n), decimals),
    ),
  };

  if (budget === undefined) return offer;

  const quote = quoteOffer(
    parseUnits(budget.toFixed(decimals), decimals),
    priceRaw,
    availableRaw,
  );

  return {
    ...offer,
    quote: {
      budget,
      tokens: Number(formatUnits(quote.tokens, 18)),
      cost: Number(formatUnits(quote.cost, decimals)),
      protocolFee: Number(formatUnits(quote.fee, decimals)),
      totalPaid: Number(formatUnits(quote.total, decimals)),
      limitedByPoolSize: quote.limitedByPoolSize,
      unspent: Number(formatUnits(quote.unspent, decimals)),
    },
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
