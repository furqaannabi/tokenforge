import { X_LAYER_TESTNET } from "@/lib/wagmi";

/**
 * Deployed contract addresses.
 *
 * The app reads registry membership from the chain rather than from a list it
 * keeps itself. That matters for the claim the product makes: "only verified
 * issuers can mint" is enforced by `NoteFactory`, so the interface has to be
 * reading the same source the contract does. A local allowlist would drift the
 * moment an admin admitted someone, and would disagree in the direction that
 * looks worst — showing a wallet as verified that the chain would reject.
 */

function required(name: string, value: string | undefined): `0x${string}` {
  if (!value) {
    throw new Error(
      `${name} is not set. Addresses for the current deployment are in contracts/deployments/xlayer-testnet.json.`,
    );
  }
  return value as `0x${string}`;
}

export const CHAIN_ID = Number(
  process.env.NEXT_PUBLIC_CHAIN_ID ?? X_LAYER_TESTNET.id,
);

export const addresses = {
  issuerRegistry: process.env.NEXT_PUBLIC_ISSUER_REGISTRY_ADDRESS as
    | `0x${string}`
    | undefined,
  noteFactory: process.env.NEXT_PUBLIC_NOTE_FACTORY_ADDRESS as
    | `0x${string}`
    | undefined,
  usdg: process.env.NEXT_PUBLIC_USDG_ADDRESS as `0x${string}` | undefined,
};

export function issuerRegistryAddress(): `0x${string}` {
  return required("NEXT_PUBLIC_ISSUER_REGISTRY_ADDRESS", addresses.issuerRegistry);
}

/** Whether the app has been told where the contracts live. */
export const contractsConfigured = Boolean(addresses.issuerRegistry);

export { issuerRegistryAbi } from "./issuer-registry";
export { noteFactoryAbi } from "./noteFactory";
export { rwaNoteAbi } from "./rwaNote";
export { repaymentVaultAbi } from "./repaymentVault";
