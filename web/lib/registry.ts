import { REGISTERED_ISSUERS } from "./mock-data";
import type { Issuer } from "./types";

/**
 * Registry membership.
 *
 * This is a stand-in for `IssuerRegistry.isRegisteredIssuer(address)` and is
 * deliberately shaped like that call, so swapping it for a `useReadContract`
 * once the registry is deployed touches only this file.
 *
 * Until then membership resolves against the demo fixtures plus any addresses
 * in NEXT_PUBLIC_DEMO_VERIFIED_ISSUERS — which is how you make your own wallet
 * a verified issuer while running the demo.
 */

function envIssuers(): Issuer[] {
  const raw = process.env.NEXT_PUBLIC_DEMO_VERIFIED_ISSUERS;
  if (!raw) return [];

  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => /^0x[0-9a-fA-F]{40}$/.test(entry))
    .map((address) => ({
      name: "Demo Issuer",
      address: address as `0x${string}`,
      verified: true,
      jurisdiction: "Delaware, USA",
    }));
}

function allIssuers(): Issuer[] {
  return [...REGISTERED_ISSUERS, ...envIssuers()];
}

export function isRegisteredIssuer(address?: string): boolean {
  if (!address) return false;
  return allIssuers().some(
    (issuer) => issuer.address.toLowerCase() === address.toLowerCase(),
  );
}

/**
 * The registry entry for a connected address, or a synthetic unverified one.
 *
 * Returning an issuer either way keeps the refusal path concrete: the UI can
 * name the address it is rejecting instead of showing an empty state.
 */
export function resolveIssuer(address?: string): Issuer | null {
  if (!address) return null;

  const match = allIssuers().find(
    (issuer) => issuer.address.toLowerCase() === address.toLowerCase(),
  );
  if (match) return match;

  return {
    name: "Unregistered Wallet",
    address: address as `0x${string}`,
    verified: false,
    jurisdiction: "Unknown",
  };
}
