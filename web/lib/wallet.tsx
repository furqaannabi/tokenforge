"use client";

/**
 * The connected wallet, and what the registry says about it.
 *
 * Backed by wagmi rather than a mock. The one piece of judgement layered on top
 * is `issuer.verified`, which resolves the connected address against the issuer
 * registry — that flag is what gates minting, and connecting an address outside
 * the registry has to produce the same refusal `NoteFactory` would.
 *
 * wagmi 3 deprecates `useAccount` in favour of `useConnection`, and the
 * `disconnect` field of `useDisconnect` in favour of its `mutate`.
 */

import { useConnection, useDisconnect } from "wagmi";
import { resolveIssuer } from "./registry";
import { X_LAYER_TESTNET } from "./wagmi";
import type { Issuer } from "./types";

export interface WalletState {
  address?: `0x${string}`;
  connected: boolean;
  /** True while wagmi restores a previous session. */
  connecting: boolean;
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

  return {
    address,
    chainId,
    connected: isConnected,
    connecting: isConnecting || isReconnecting,
    issuer: resolveIssuer(address),
    wrongNetwork: isConnected && chainId !== Number(X_LAYER_TESTNET.id),
    disconnect: () => disconnect(),
  };
}
