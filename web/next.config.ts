import type { NextConfig } from "next";

/**
 * AppKit's wagmi adapter re-exports every wagmi connector, including Coinbase's
 * Base Account one. That pulls in @coinbase/cdp-sdk, which statically imports
 * the `@x402/*` packages (Coinbase's payments protocol, plus Solana support)
 * while declaring them as *optional* peer dependencies — so they are absent and
 * the bundler cannot resolve them.
 *
 * TokenForge uses neither x402 nor Solana, and the modules are unreachable at
 * runtime because nothing here constructs a Base Account connector. Pointing
 * them at a stub is the documented Turbopack equivalent of webpack's
 * `resolve.fallback`.
 *
 * Revisit if Base Account support is ever wanted: install the @x402 packages
 * and drop these aliases.
 */
const X402_STUBS = [
  "@x402/core/client",
  "@x402/evm",
  "@x402/evm/exact/client",
  "@x402/evm/upto/client",
  "@x402/svm/exact/client",
] as const;

const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: Object.fromEntries(
      X402_STUBS.map((specifier) => [specifier, "./lib/x402-stub.cjs"]),
    ),
  },
};

export default nextConfig;
