/**
 * What a budget buys from a primary offering.
 *
 * The sums live here rather than in a prompt because they have one right
 * answer and a language model was getting them wrong in two ways at once:
 * reading a price of 1,500 USDG as 1.50, and answering "5,000 would buy you
 * 3,333 tokens" from a pool that held 321. Both are the same class of mistake
 * as the amortisation in `amortise.ts` — arithmetic handed to something that
 * reasons rather than calculates.
 *
 * Every rounding direction here matches `SaleDesk.quote` and `SaleDesk.feeOn`,
 * so the figure quoted is the figure charged.
 */

/** The note ledger is 18-decimal, independent of the settlement currency. */
const TOKEN_SCALE = 10n ** 18n;

/** 25 basis points to each side of a primary sale. */
export const PROTOCOL_FEE_BPS = 25n;

export function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (numerator === 0n) return 0n;
  return (numerator + denominator - 1n) / denominator;
}

export interface OfferQuote {
  /** Tokens the buyer receives, capped by what is actually for sale. */
  tokens: bigint;
  /** Paid to the issuer, before the fee. */
  cost: bigint;
  /** The buyer's 25 bps. The seller pays their own, out of the proceeds. */
  fee: bigint;
  /** cost + fee, which is what leaves the wallet. */
  total: bigint;
  /** True when the pool ran out before the budget did. */
  limitedByPoolSize: boolean;
  /** Budget left over, which is non-zero exactly when the pool was the limit. */
  unspent: bigint;
}

/**
 * @param budget What the buyer will spend, in settlement-currency units.
 * @param pricePerToken Per whole token, in settlement-currency units.
 * @param available Tokens for sale, 18-decimal.
 */
export function quoteOffer(
  budget: bigint,
  pricePerToken: bigint,
  available: bigint,
): OfferQuote {
  if (pricePerToken <= 0n || available <= 0n || budget <= 0n) {
    return { tokens: 0n, cost: 0n, fee: 0n, total: 0n, limitedByPoolSize: false, unspent: budget > 0n ? budget : 0n };
  }

  /*
   * The fee comes out of the budget rather than being added on top. A buyer
   * who says "I have 5,000" means 5,000 leaves the wallet, so deriving tokens
   * from the gross and adding 0.25% afterwards would charge more than the
   * figure they named.
   */
  const net = (budget * 10_000n) / (10_000n + PROTOCOL_FEE_BPS);
  const wanted = (net * TOKEN_SCALE) / pricePerToken;

  // The pool is the ceiling, and forgetting it is the whole reason this exists.
  const limitedByPoolSize = wanted > available;
  const tokens = limitedByPoolSize ? available : wanted;

  const cost = ceilDiv(tokens * pricePerToken, TOKEN_SCALE);
  const fee = cost === 0n ? 0n : ceilDiv(cost * PROTOCOL_FEE_BPS, 10_000n);
  const total = cost + fee;

  return { tokens, cost, fee, total, limitedByPoolSize, unspent: budget - total };
}
