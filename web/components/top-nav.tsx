"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BadgeCheck, TriangleAlert } from "lucide-react";
import { useWallet } from "@/lib/wallet";
import { truncateHex } from "@/lib/format";
import { Stamp } from "@/components/primitives";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/", label: "Issue" },
  { href: "/registry", label: "Registry" },
] as const;

export function TopNav() {
  const pathname = usePathname();
  const { issuer, available, switchWallet } = useWallet();

  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-8 px-6">
        <Link href="/" className="flex items-baseline gap-2">
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
          {issuer ? (
            issuer.verified ? (
              <Stamp tone="verified">
                <BadgeCheck /> Verified Issuer
              </Stamp>
            ) : (
              <Stamp tone="impaired">
                <TriangleAlert /> Unregistered
              </Stamp>
            )
          ) : null}

          {/*
            Demo affordance rather than a product feature: switching to the
            unregistered wallet is how the on-chain rejection is reached.
          */}
          <Select
            value={issuer?.address ?? ""}
            onValueChange={(value) => switchWallet(value as `0x${string}`)}
          >
            <SelectTrigger
              size="sm"
              className="font-mono text-xs"
              aria-label="Connected wallet"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {available.map((wallet) => (
                <SelectItem
                  key={wallet.address}
                  value={wallet.address}
                  className="font-mono text-xs"
                >
                  {truncateHex(wallet.address, 6, 4)} · {wallet.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </header>
  );
}
