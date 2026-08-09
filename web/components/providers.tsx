"use client";

import { useState } from "react";
import { createAppKit } from "@reown/appkit/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import {
  APPKIT_METADATA,
  NETWORKS,
  hasProjectId,
  projectId,
  wagmiAdapter,
  wagmiConfig,
} from "@/lib/wagmi";

/*
 * AppKit is created once at module scope, before any component renders.
 * Without a project ID the WalletConnect relay is unavailable, so we skip
 * initialisation entirely and the nav falls back to an injected-only connect
 * button rather than opening a modal that could never complete a session.
 */
if (hasProjectId) {
  createAppKit({
    adapters: [wagmiAdapter],
    networks: NETWORKS,
    projectId: projectId!,
    metadata: APPKIT_METADATA,
    themeMode: "dark",
    themeVariables: {
      "--w3m-accent": "#10b981",
      "--w3m-border-radius-master": "1px",
    },
    features: { analytics: false },
  });
}

export function Providers({ children }: { children: React.ReactNode }) {
  // Held in state so a re-render never discards the cache.
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
