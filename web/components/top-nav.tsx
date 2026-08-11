"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import "@reown/appkit/react";
import { useConnect, useConnectors } from "wagmi";
import {
  BadgeCheck,
  Menu,
  ShieldOff,
  TriangleAlert,
  Wallet,
  X,
} from "lucide-react";
import { useWallet } from "@/lib/wallet";
import { useIsRegistryAdmin } from "@/lib/registry";
import { hasProjectId } from "@/lib/wagmi";
import { FieldLabel, Stamp } from "@/components/primitives";
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

type NavLink = { href: string; label: string };

/**
 * The top bar.
 *
 * Two layouts rather than one that shrinks. Five links, a brand and a wallet
 * button cannot share 375px, and the previous compromise — scrolling the links
 * sideways — hid whichever ones happened to overflow, which on a phone meant
 * the admin never saw their own queue. Below `sm` the links collapse into a
 * menu; above it they sit inline as before.
 */
export function TopNav() {
  const pathname = usePathname();
  const { issuer, address, connected, connecting, wrongNetwork, disconnect } =
    useWallet();
  const { isAdmin } = useIsRegistryAdmin(address);
  const links: NavLink[] = isAdmin ? [...LINKS, ADMIN_LINK] : [...LINKS];

  /*
   * The menu remembers which route it was opened on, and a route change closes
   * it by making that memory stale. Deriving it beats an effect that calls
   * setState on every navigation: this also covers the browser's own back and
   * forward, which no link handler would ever see.
   */
  const [menu, setMenu] = useState({ open: false, at: pathname });
  const open = menu.open && menu.at === pathname;
  const setOpen = (next: boolean) => setMenu({ open: next, at: pathname });

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      // `setMenu` is stable; `setOpen` closes over `pathname` and would rebind
      // this listener on every navigation for no benefit.
      if (event.key === "Escape") setMenu((was) => ({ ...was, open: false }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-card">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-3 px-4 sm:gap-6 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <Image
            src="/logo.png"
            alt="TokenForge"
            width={28}
            height={28}
            className="shrink-0 rounded-md"
            priority
          />
          <span className="text-base font-bold tracking-tight">TokenForge</span>
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground lg:inline">
            Institutional RWA
          </span>
        </Link>

        <nav className="hidden shrink-0 items-center gap-1 sm:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive(pathname, link.href) ? "page" : undefined}
              className={cn(
                "rounded px-2 py-1.5 text-sm transition-colors sm:px-3",
                isActive(pathname, link.href)
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
          {wrongNetwork ? (
            <Stamp tone="review">
              <TriangleAlert />
              <span className="hidden sm:inline">Wrong network</span>
            </Stamp>
          ) : null}

          {connected && issuer ? (
            issuer.verified ? (
              <Stamp tone="verified" className="hidden lg:inline-flex">
                <BadgeCheck /> Verified Issuer
              </Stamp>
            ) : (
              <Stamp tone="impaired" className="hidden lg:inline-flex">
                <ShieldOff /> Unregistered
              </Stamp>
            )
          ) : null}

          {/*
            AppKit's own account button, rather than a hand-rolled one. It
            already handles the states this bar kept getting wrong on a phone:
            connect, the truncated address, switching network, and disconnect
            behind a deliberate tap instead of the accidental one a bare
            address button invites. It only exists once `createAppKit` has run,
            so the injected-only fallback stays for a missing project ID.
          */}
          {hasProjectId ? (
            /*
              The custom element rather than the React wrapper, because the
              wrapper types its props as `{}` and this needs `size`. At the
              default size the button renders narrower than its own label and
              clips it to "Connect Walle" on a phone; `sm` fits the text. The
              `label` prop is declared for this element but ignored by 1.8.23 —
              setting it changes nothing, so it is not set.
            */
            <appkit-button size="sm" balance="hide" />
          ) : (
            <InjectedConnect connecting={connecting} />
          )}

          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            className="-mr-2 flex size-10 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground sm:hidden"
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>

      {open ? (
        <nav
          id="mobile-nav"
          className="border-t border-border bg-card sm:hidden"
        >
          <ul className="px-2 py-2">
            {links.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={
                    isActive(pathname, link.href) ? "page" : undefined
                  }
                  className={cn(
                    "block rounded px-3 py-3 text-sm transition-colors",
                    isActive(pathname, link.href)
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>

          {connected && issuer ? (
            <div className="border-t border-border px-5 py-4">
              <FieldLabel className="block">Wallet</FieldLabel>
              <code className="mt-1 block font-mono text-xs break-all text-muted-foreground">
                {issuer.address}
              </code>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {issuer.verified ? (
                  <Stamp tone="verified">
                    <BadgeCheck /> Verified Issuer
                  </Stamp>
                ) : (
                  <Stamp tone="impaired">
                    <ShieldOff /> Unregistered
                  </Stamp>
                )}
                {hasProjectId ? null : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setOpen(false);
                      disconnect();
                    }}
                    className="ml-auto"
                  >
                    Disconnect
                  </Button>
                )}
              </div>
            </div>
          ) : null}
        </nav>
      ) : null}
    </header>
  );
}

/** `/` matches only itself; everything else matches its own subtree. */
function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
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
