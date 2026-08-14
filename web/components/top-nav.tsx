"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import "@reown/appkit/react";
import { useConnect, useConnectors } from "wagmi";
import { BadgeCheck, ShieldOff, TriangleAlert, Wallet } from "lucide-react";
import { useWallet } from "@/lib/wallet";
import { hasProjectId } from "@/lib/wagmi";
import { Stamp } from "@/components/primitives";
import { Button } from "@/components/ui/button";

/**
 * The top bar.
 *
 * There is nothing to navigate to. The five screens became tabs on one page,
 * so the bar carries the brand and the wallet and stops there — which also
 * ends the fight for room that made it overlap on a phone, and retires the
 * hamburger built to manage it.
 */
export function TopNav() {
  const { issuer, connected, connecting, wrongNetwork } = useWallet();
  const pathname = usePathname();

  // The landing page has its own header, and a wallet button above the fold
  // there would ask for a connection before saying what the product is.
  if (pathname === "/") return null;

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-card">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-3 px-4 sm:px-6">
        {/* The mark alone, back to the landing page. The name is on the page
            it leads to, and repeating it in the bar costs width that the
            wallet controls need on a phone. */}
        <Link
          href="/"
          aria-label="TokenForge home"
          className="flex shrink-0 items-center rounded-md"
        >
          <Image
            src="/logo.png"
            alt=""
            width={28}
            height={28}
            className="shrink-0 rounded-md"
            priority
          />
        </Link>

        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
          {wrongNetwork ? (
            <Stamp tone="review">
              <TriangleAlert />
              <span className="hidden sm:inline">Wrong network</span>
            </Stamp>
          ) : null}

          {connected && issuer ? (
            issuer.verified ? (
              <Stamp tone="verified" className="hidden sm:inline-flex">
                <BadgeCheck /> Verified Issuer
              </Stamp>
            ) : (
              <Stamp tone="impaired" className="hidden sm:inline-flex">
                <ShieldOff /> Unregistered
              </Stamp>
            )
          ) : null}

          {/*
            AppKit's own account button. It handles connect, the truncated
            address, switching network and disconnect. `size="sm"` because at
            the default it renders narrower than its own label and clips it to
            "Connect Walle" on a phone.
          */}
          {hasProjectId ? (
            <appkit-button size="sm" balance="hide" />
          ) : (
            <InjectedConnect connecting={connecting} />
          )}
        </div>
      </div>
    </header>
  );
}

/**
 * Fallback when NEXT_PUBLIC_REOWN_PROJECT_ID is unset. The WalletConnect relay
 * needs that ID, so only browser-injected wallets can connect here.
 */
function InjectedConnect({ connecting }: { connecting: boolean }) {
  const connectors = useConnectors();
  const { mutate: connect } = useConnect();
  const injected = connectors[0];

  return (
    <Button
      size="sm"
      onClick={() => injected && connect({ connector: injected })}
      disabled={connecting || !injected}
      title={
        injected
          ? undefined
          : "No browser wallet detected. Set NEXT_PUBLIC_REOWN_PROJECT_ID to enable WalletConnect."
      }
    >
      <Wallet />
      <span className="hidden sm:inline">
        {connecting ? "Connecting…" : "Connect wallet"}
      </span>
      <span className="sm:hidden">{connecting ? "…" : "Connect"}</span>
    </Button>
  );
}
