"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { useIsRegistryAdmin } from "@/lib/registry";
import { cn } from "@/lib/utils";
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
  const { issuer, connected, connecting, wrongNetwork, address } = useWallet();
  const { isAdmin } = useIsRegistryAdmin(address);
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  // A menu that survives navigation stays open over the page it just opened.
  useEffect(() => setMenuOpen(false), [pathname]);

  /*
   * The same sections the workspace shows, under the same conditions.
   *
   * Duplicated deliberately rather than lifted into shared state: the tab bar
   * is the source of truth for what is available, and a menu that offered a
   * section the workspace would not render is worse than one that repeats it.
   */
  const sections = [
    { id: "notes", label: "All notes", when: true },
    { id: "mine", label: "My notes", when: connected },
    { id: "issue", label: "New note", when: Boolean(issuer?.verified) },
    { id: "registry", label: "Registry", when: true },
    { id: "admin", label: "Admin", when: isAdmin },
  ].filter((section) => section.when);

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

        {/* Sections live in the tab bar on a wide screen; on a phone that bar
            scrolls sideways and its right-hand tabs are easy to miss. */}
        <button
          type="button"
          onClick={() => setMenuOpen((was) => !was)}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          className="ml-1 flex size-9 items-center justify-center rounded-md text-muted-foreground hover:text-foreground sm:hidden"
        >
          {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>

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

      {menuOpen ? (
        <nav
          aria-label="Sections"
          className="border-t border-border bg-card px-2 pb-2 sm:hidden"
        >
          {sections.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => {
                /* The workspace reads its tab from the query string, so this
                   is a navigation rather than a message to a sibling. */
                router.push(
                  section.id === "notes" ? "/app" : `/app?view=${section.id}`,
                );
                setMenuOpen(false);
              }}
              className="block w-full rounded-md px-3 py-2.5 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {section.label}
            </button>
          ))}
        </nav>
      ) : null}
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
