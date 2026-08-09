import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { xLayerTestnet } from "@reown/appkit/networks";
import { cookieStorage, createStorage } from "wagmi";
import { injected } from "wagmi/connectors";
import type { AppKitNetwork } from "@reown/appkit/networks";

/**
 * Wallet connection for X Layer testnet.
 *
 * Chain 1952, verified directly against the RPC (`eth_chainId` returns 0x7a0 on
 * both xlayertestrpc.okx.com and testrpc.xlayer.tech). viem still carries the
 * pre-rebrand "X1 Testnet" name for it, which is why the label is overridden
 * below. Mainnet, for reference, is 196.
 */
export const X_LAYER_TESTNET: AppKitNetwork = {
  ...xLayerTestnet,
  name: "X Layer Testnet",
};

export const NETWORKS: [AppKitNetwork, ...AppKitNetwork[]] = [X_LAYER_TESTNET];

/**
 * From cloud.reown.com. Without it the WalletConnect relay — and therefore
 * QR-code and mobile wallet connections — cannot work, so we fall back to
 * injected-only (MetaMask, OKX Wallet) rather than crashing the app.
 */
export const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID;

export const hasProjectId = Boolean(projectId);

export const wagmiAdapter = new WagmiAdapter({
  networks: NETWORKS,
  projectId: projectId ?? "",
  // Cookie storage keeps the connection readable during SSR.
  storage: createStorage({ storage: cookieStorage }),
  ssr: true,
  ...(hasProjectId ? {} : { connectors: [injected()] }),
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;

export const APPKIT_METADATA = {
  name: "TokenForge",
  description:
    "Only verified issuers can turn real financial agreements into programmable onchain assets.",
  url: "https://tokenforge.local",
  icons: [],
};
