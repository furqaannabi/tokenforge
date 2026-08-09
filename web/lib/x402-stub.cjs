/**
 * Stub for the optional `@x402/*` peer dependencies. See next.config.ts.
 *
 * CommonJS on purpose: an ES module's exports are statically known, so any
 * named import the bundler sees would fail to resolve. A CJS proxy satisfies
 * every named import at build time and throws only if one is ever actually
 * called — which nothing in TokenForge does, since it uses neither x402 nor
 * Solana.
 */
module.exports = new Proxy(
  {},
  {
    get(_target, property) {
      if (property === "__esModule") return false;
      if (typeof property === "symbol") return undefined;
      return () => {
        throw new Error(
          `@x402 is not installed: '${String(property)}' was called. ` +
            "TokenForge stubs this optional Coinbase dependency in next.config.ts.",
        );
      };
    },
  },
);
