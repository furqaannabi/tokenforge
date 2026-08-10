"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAppKit } from "@reown/appkit/react";
import { useConnect, useConnectors } from "wagmi";
import { BadgeCheck, ShieldOff, TriangleAlert, Wallet } from "lucide-react";
import { useWallet } from "@/lib/wallet";
import { useIsRegistryAdmin } from "@/lib/registry";
import { hasProjectId } from "@/lib/wagmi";
import { truncateHex } from "@/lib/format";
import { Stamp } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/notes", label: "Notes" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/", label: "Issue" },
  { href: "/registry", label: "Registry" },
] as const;

/**
 * Only the registry's own admin sees this.
 *
 * The gate is cosmetic — `admitIssuer` reverts for anyone else regardless — but
 * showing a door that will not open to every visitor is its own kind of lie.
 */
const ADMIN_LINK = { href: "/admin", label: "Admin" } as const;

export function TopNav() {
  const pathname = usePathname();
  const { issuer, address, connected, connecting, wrongNetwork, disconnect } =
    useWallet();
  const { isAdmin } = useIsRegistryAdmin(address);
  const links = isAdmin ? [...LINKS, ADMIN_LINK] : LINKS;

  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-3 px-4 sm:gap-6 sm:px-6">
        {/*
          Everything in this bar is shrink-0. Without it the brand, the links
          and the connect button add up to more than a phone's width, and flex
          resolves that by compressing the text until the wordmark and the
          links run into each other. The wordmark is the one item that can go:
          the logo carries the brand on its own at that size.
        */}
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <Image
            src="/logo.png"
            alt="TokenForge"
            width={28}
            height={28}
            className="shrink-0 rounded-md"
            priority
          />
          <span className="hidden text-base font-bold tracking-tight sm:inline">
            TokenForge
          </span>
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground lg:inline">
            Institutional RWA
          </span>
        </Link>

        <nav className="flex min-w-0 items-center gap-0.5 overflow-x-auto sm:gap-1">
          {links.map((link) => {
            const active =
              link.href === "/"
                ? pathname === "/"
                : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "rounded px-2 py-1.5 text-sm transition-colors sm:px-3",
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

        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
          {wrongNetwork ? (
            <Stamp tone="review">
              <TriangleAlert />
              <span className="hidden sm:inline">Wrong network</span>
            </Stamp>
          ) : null}

          {connected && issuer ? (
            <>
              {issuer.verified ? (
                <Stamp tone="verified" className="hidden sm:inline-flex">
                  <BadgeCheck /> Verified Issuer
                </Stamp>
              ) : (
                <Stamp tone="impaired" className="hidden sm:inline-flex">
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
      <Wallet />
      <span className="hidden sm:inline">
        {connecting ? "Connecting…" : "Connect wallet"}
      </span>
      <span className="sm:hidden">{connecting ? "…" : "Connect"}</span>
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
      <Wallet />
      <span className="hidden sm:inline">
        {connecting ? "Connecting…" : "Connect wallet"}
      </span>
      <span className="sm:hidden">{connecting ? "…" : "Connect"}</span>
    </Button>
  );
}
