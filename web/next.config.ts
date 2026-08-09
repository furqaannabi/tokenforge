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
  // @tokenforge/core ships TypeScript source rather than a build artifact, so
  // that the schema and validator have exactly one definition shared with the
  // extraction service. Next has to compile it like first-party code.
  transpilePackages: ["@tokenforge/core"],
  turbopack: {
    // No `root` override here. It was needed when web/ was its own pnpm root
    // and @tokenforge/core sat outside it, but pointing the root above the app
    // made Vercel resolve build output to web/web/.next and fail. The workspace
    // at the repository root now gives Turbopack the correct root on its own.
    resolveAlias: Object.fromEntries(
      X402_STUBS.map((specifier) => [specifier, "./lib/x402-stub.cjs"]),
    ),
  },
};

export default nextConfig;
