"use client";

/**
 * The connected wallet, and what the registry says about it.
 *
 * `verified` comes from `IssuerRegistry` on-chain, not from a list this app
 * keeps. That is the whole point of the gate: `NoteFactory` reverts for
 * addresses the registry does not recognise, so the interface has to be reading
 * the same source rather than a copy that can drift.
 *
 * wagmi 3 deprecates `useAccount` in favour of `useConnection`, and the
 * `disconnect` field of `useDisconnect` in favour of its `mutate`.
 */

import { useConnection, useDisconnect } from "wagmi";
import { useIsRegisteredIssuer, useIssuerInfo } from "./registry";
import { X_LAYER_TESTNET } from "./wagmi";
import type { Issuer } from "./types";

export interface WalletState {
  address?: `0x${string}`;
  connected: boolean;
  /** True while wagmi restores a previous session. */
  connecting: boolean;
  /** True while the registry read is in flight — distinct from "not verified". */
  checkingRegistry: boolean;
  /** Registry entry for the connected address, or a synthetic unverified one. */
  issuer: Issuer | null;
  chainId?: number;
  /** Connected, but pointed at something other than X Layer testnet. */
  wrongNetwork: boolean;
  disconnect: () => void;
}

export function useWallet(): WalletState {
  const connection = useConnection();
  const { mutate: disconnect } = useDisconnect();

  const { address, chainId, isConnected, isConnecting, isReconnecting } =
    connection;

  const registry = useIsRegisteredIssuer(address);
  const info = useIssuerInfo(address);

  const onChain = info.data as
    | { name: string; jurisdiction: string; registered: boolean }
    | undefined;

  return {
    address,
    chainId,
    connected: isConnected,
    connecting: isConnecting || isReconnecting,
    checkingRegistry: registry.isLoading,
    issuer: address
      ? {
          // The registry records a name only for issuers it admitted.
          name: onChain?.name || "Unregistered Wallet",
          address,
          verified: registry.verified,
          jurisdiction: onChain?.jurisdiction || "—",
        }
      : null,
    wrongNetwork: isConnected && chainId !== Number(X_LAYER_TESTNET.id),
    disconnect: () => disconnect(),
  };
}
