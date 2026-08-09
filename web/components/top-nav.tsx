"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAppKit } from "@reown/appkit/react";
import { useConnect, useConnectors } from "wagmi";
import { BadgeCheck, ShieldOff, TriangleAlert, Wallet } from "lucide-react";
import { useWallet } from "@/lib/wallet";
import { hasProjectId } from "@/lib/wagmi";
import { truncateHex } from "@/lib/format";
import { Stamp } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/", label: "Issue" },
  { href: "/registry", label: "Registry" },
] as const;

export function TopNav() {
  const pathname = usePathname();
  const { issuer, connected, connecting, wrongNetwork, disconnect } =
    useWallet();

  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-8 px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <Image
            src="/logo.png"
            alt=""
            width={28}
            height={28}
            className="rounded-md"
            priority
          />
          <span className="text-base font-bold tracking-tight">TokenForge</span>
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground sm:inline">
            Institutional RWA
          </span>
        </Link>

        <nav className="flex items-center gap-1">
          {LINKS.map((link) => {
            const active =
              link.href === "/"
                ? pathname === "/"
                : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "rounded px-3 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {wrongNetwork ? (
            <Stamp tone="review">
              <TriangleAlert /> Wrong network
            </Stamp>
          ) : null}

          {connected && issuer ? (
            <>
              {issuer.verified ? (
                <Stamp tone="verified">
                  <BadgeCheck /> Verified Issuer
                </Stamp>
              ) : (
                <Stamp tone="impaired">
                  <ShieldOff /> Unregistered
                </Stamp>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={disconnect}
                className="font-mono text-xs"
              >
                {truncateHex(issuer.address, 6, 4)}
              </Button>
            </>
          ) : hasProjectId ? (
            <AppKitConnect connecting={connecting} />
          ) : (
            <InjectedConnect connecting={connecting} />
          )}
        </div>
      </div>
    </header>
  );
}

/** Full AppKit modal — injected wallets, WalletConnect QR, and mobile deep links. */
function AppKitConnect({ connecting }: { connecting: boolean }) {
  const { open } = useAppKit();
  return (
    <Button size="sm" onClick={() => open()} disabled={connecting}>
      <Wallet /> {connecting ? "Connecting…" : "Connect wallet"}
    </Button>
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
      <Wallet /> {connecting ? "Connecting…" : "Connect wallet"}
    </Button>
  );
}
