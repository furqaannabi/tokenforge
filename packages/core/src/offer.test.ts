import { test, expect } from "bun:test";
import { parseUnits, formatUnits } from "viem";
import { quoteOffer } from "./offer";

/**
 * The figures are the ones from the live offering the assistant got wrong:
 * 321.7768 tokens for sale at 1,500 USDG, asked what 5,000 USDG would buy.
 */
const usdg = (n: string) => parseUnits(n, 6);
const tok = (n: string) => parseUnits(n, 18);

const AVAILABLE = tok("321.7768");
const PRICE = usdg("1500");

const readable = (v: bigint, d: number) => Number(formatUnits(v, d));

test("a budget smaller than the pool buys what it can afford", () => {
  const q = quoteOffer(usdg("5000"), PRICE, AVAILABLE);

  // 5,000 net of the 0.25% fee, over 1,500 a token. Emphatically not 3,333,
  // which is what dividing by a misread price of 1.50 produces.
  expect(readable(q.tokens, 18)).toBeCloseTo(3.325, 3);
  expect(q.limitedByPoolSize).toBe(false);
  expect(readable(q.total, 6)).toBeLessThanOrEqual(5000);
});

test("the buyer never pays more than the budget they named", () => {
  for (const budget of ["1", "999.99", "5000", "123456.78"]) {
    const q = quoteOffer(usdg(budget), PRICE, AVAILABLE);
    expect(readable(q.total, 6)).toBeLessThanOrEqual(Number(budget));
    expect(q.unspent).toBeGreaterThanOrEqual(0n);
  }
});

test("the fee is a quarter of a percent of the cost, rounded up", () => {
  const q = quoteOffer(usdg("5000"), PRICE, AVAILABLE);
  expect(readable(q.fee, 6)).toBeCloseTo(readable(q.cost, 6) * 0.0025, 1);
  expect(q.total).toBe(q.cost + q.fee);
});

/** The failure this file exists for. */
test("a budget larger than the pool is capped at what is for sale", () => {
  const q = quoteOffer(usdg("1000000"), PRICE, AVAILABLE);

  expect(q.tokens).toBe(AVAILABLE);
  expect(q.limitedByPoolSize).toBe(true);
  // And it says so with change left over, rather than quietly selling more
  // than exists.
  expect(readable(q.unspent, 6)).toBeGreaterThan(0);
});

test("a budget exactly clearing the pool is not reported as limited", () => {
  const whole = quoteOffer(usdg("1000000"), PRICE, AVAILABLE);
  const exact = quoteOffer(whole.total, PRICE, AVAILABLE);
  expect(exact.tokens).toBe(AVAILABLE);
  expect(readable(exact.unspent, 6)).toBeCloseTo(0, 2);
});

test("nothing for sale quotes nothing, and spends nothing", () => {
  const q = quoteOffer(usdg("5000"), PRICE, 0n);
  expect(q.tokens).toBe(0n);
  expect(q.total).toBe(0n);
  expect(readable(q.unspent, 6)).toBe(5000);
});

test("a zero budget is not a purchase", () => {
  const q = quoteOffer(0n, PRICE, AVAILABLE);
  expect(q.tokens).toBe(0n);
  expect(q.total).toBe(0n);
});
