"use client";

/**
 * Mock wallet connection.
 *
 * Stands in for wagmi/viem until the contracts land. The one thing it models
 * faithfully is registry membership: `issuer.verified` is what gates the mint,
 * and connecting as the unverified wallet has to produce the same refusal the
 * on-chain `NoteFactory` would.
 */

import { createContext, useContext, useMemo, useState } from "react";
import { DEMO_WALLETS, MERIDIAN } from "./mock-data";
import type { Issuer } from "./types";

interface WalletState {
  /** Null until connected. */
  issuer: Issuer | null;
  connected: boolean;
  connect: (issuer?: Issuer) => void;
  disconnect: () => void;
  /** Demo affordance: swap between the verified and unverified wallets. */
  switchWallet: (address: Issuer["address"]) => void;
  available: Issuer[];
}

const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  // Pre-connected as the verified issuer so the happy path stays fast; the
  // rejection case is reached deliberately, by switching wallets.
  const [issuer, setIssuer] = useState<Issuer | null>(MERIDIAN);

  const value = useMemo<WalletState>(
    () => ({
      issuer,
      connected: issuer !== null,
      connect: (next = MERIDIAN) => setIssuer(next),
      disconnect: () => setIssuer(null),
      switchWallet: (address) =>
        setIssuer(DEMO_WALLETS.find((w) => w.address === address) ?? null),
      available: DEMO_WALLETS,
    }),
    [issuer],
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

export function useWallet(): WalletState {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error("useWallet must be used inside a WalletProvider");
  }
  return context;
}
