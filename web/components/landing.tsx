"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  ShieldCheck,
  Coins,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { BASE_URL } from "@/lib/api";
import { Reveal } from "@/components/reveal";
import { Journey } from "@/components/journey";

/**
 * The front door.
 *
 * Everything here is a claim about a system that handles money, so the page is
 * held to the same standard as the product: no invented figures, no "trusted by
 * institutions", no returns implied. The counters below are read from the live
 * service and simply do not render when it cannot be reached — a landing page
 * that fabricates activity is the first lie a platform tells.
 */

const X_URL = "https://x.com/0xTokenForge";

/** lucide dropped its Twitter glyph and has no X; this is the mark itself. */
function XLogo({ className = "size-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={className}
      fill="currentColor"
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

interface Totals {
  notes: number;
  documents: number;
}

/** The one number worth leading with, or nothing. */
function useTotals(): Totals | null {
  const [totals, setTotals] = useState<Totals | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(`${BASE_URL}/stats`);
        if (!response.ok) return;
        const data = (await response.json()) as Totals;
        if (cancelled) return;
        setTotals({ notes: data.notes, documents: data.documents });
      } catch {
        // Offline is a fine state for a landing page. It shows the copy and
        // omits the counters rather than rendering zeros that read as failure.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return totals;
}

export function Landing() {
  const totals = useTotals();

  return (
    <div className="relative overflow-hidden">
      {/*
        Two washes and a grid, all behind `pointer-events-none`. The grid fades
        out toward the bottom with a mask so it never competes with the text —
        a background that stays a background.
      */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          backgroundImage:
            "radial-gradient(60rem 40rem at 50% -10%, rgba(16,185,129,0.10), transparent 70%), radial-gradient(40rem 30rem at 85% 10%, rgba(56,189,248,0.06), transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[46rem] opacity-[0.18]"
        style={{
          backgroundImage:
            "linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage:
            "radial-gradient(ellipse 80% 60% at 50% 0%, black 40%, transparent 100%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 80% 60% at 50% 0%, black 40%, transparent 100%)",
        }}
      />

      <header className="mx-auto flex h-16 max-w-[1200px] items-center gap-3 px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <Image
            src="/logo.png"
            alt=""
            width={28}
            height={28}
            className="rounded-md"
            priority
          />
          <span className="text-base font-bold tracking-tight">TokenForge</span>
        </Link>

        <nav className="ml-auto flex items-center gap-1 sm:gap-2">
          <a
            href={X_URL}
            target="_blank"
            rel="noreferrer"
            className="flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
            aria-label="TokenForge on X"
          >
            <XLogo />
          </a>
          <Button asChild size="sm">
            <Link href="/app">
              Launch app <ArrowRight />
            </Link>
          </Button>
        </nav>
      </header>

      <main>
        <section className="mx-auto max-w-[1200px] px-4 pb-10 pt-16 sm:px-6 sm:pt-24">
          <div className="mx-auto max-w-3xl text-center">
            <Reveal as="div" className="inline-block">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
              <span className="size-1.5 rounded-full bg-verified" />
              Live on X Layer testnet
            </span>
            </Reveal>

            <Reveal delay={80}>
            <h1 className="mt-6 text-balance text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
              A signed loan agreement,
              <br className="hidden sm:block" />{" "}
              <span className="text-verified">provably</span> on-chain.
            </h1>
            </Reveal>

            <Reveal delay={160}>
            <p className="mx-auto mt-6 max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
              Upload the PDF. A model reads the economic terms and scores its own
              confidence on every field, a validator checks the arithmetic, a
              human signs off on anything shaky — and an admin approves the exact
              parameters before a verified issuer can mint. What comes out is an
              ERC-20 note whose coupons pay its holders.
            </p>
            </Reveal>

            <Reveal delay={240} className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg" className="h-11 px-6 text-base">
                <Link href="/app">
                  Launch app <ArrowRight />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="h-11 px-6 text-base"
              >
                <Link href="/app?view=notes">Browse the notes</Link>
              </Button>
            </Reveal>

            {totals ? (
              <Reveal as="div" className="mx-auto mb-4 mt-12">
              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border">
                <Figure
                  value={totals.notes}
                  label={totals.notes === 1 ? "note minted" : "notes minted"}
                />
                <Figure
                  value={totals.documents}
                  label={
                    totals.documents === 1
                      ? "agreement processed"
                      : "agreements processed"
                  }
                />
              </dl>
              </Reveal>
            ) : null}
          </div>
        </section>

        <Journey />

        <Section
          eyebrow="Three parties"
          title="A loan has three sides"
          lede="Collapsing any two of them tells a lie about who owes what to whom."
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <Party
              delay={0}
              role="Issuer"
              body="Originated the loan and wants their capital back early. Mints the note and offers part of the supply for sale."
            />
            <Party
              delay={100}
              role="Borrower"
              body="Owes the money. Named at issuance and must sign accept() themselves — until they do, the note is Pending and does nothing."
            />
            <Party
              delay={200}
              role="Holders"
              body="Own the repayments. Buy from the offering, claim their share as each period settles, and can sell on."
            />
          </div>
        </Section>

        <Section
          eyebrow="Repayment"
          title="Nobody has to remember"
          lede="The borrower grants a standing allowance; a keeper collects each instalment the day it falls due."
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <Note
              delay={0}
              icon={<Zap className="size-4 text-verified" />}
              title="Nothing to cancel"
              body="The authorization is the allowance. Lower it and collection stops on the next block — no counterparty, no notice period, nobody to ask."
            />
            <Note
              delay={100}
              icon={<ShieldCheck className="size-4 text-verified" />}
              title="The keeper takes nothing"
              body="Its call names no recipient. It moves the scheduled amount from the borrower into that note's vault, once due, and no further than their own allowance."
            />
            <Note
              delay={200}
              icon={<Coins className="size-4 text-verified" />}
              title="Balances amortize"
              body="A holder's balance falls as principal comes back — that is repayment arriving, not a loss. Shares, which measure ownership, never move."
            />
          </div>
        </Section>

        <section className="mx-auto max-w-[1200px] px-4 pb-24 sm:px-6">
          <div className="relative overflow-hidden rounded-2xl border border-border bg-card px-6 py-14 text-center sm:px-12">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                backgroundImage:
                  "radial-gradient(40rem 20rem at 50% 0%, rgba(16,185,129,0.10), transparent 70%)",
              }}
            />
            <Reveal className="relative">
              <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
                Everything is on a public testnet
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-pretty text-muted-foreground">
                Every note, every repayment and every fee is a transaction you
                can open in an explorer. Connect a wallet and read the contracts
                yourself — that is rather the point.
              </p>
              <Button asChild size="lg" className="mt-8 h-11 px-6 text-base">
                <Link href="/app">
                  Launch app <ArrowRight />
                </Link>
              </Button>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-3 px-4 py-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:px-6">
          <p>
            TokenForge — a hackathon build. Nothing here is investment advice or
            an offer of securities.
          </p>
          <a
            href={X_URL}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 transition-colors hover:text-foreground sm:ml-auto"
          >
            <XLogo className="size-3.5" /> @0xTokenForge
          </a>
          <p className="font-mono">X Layer testnet · chain 1952</p>
        </div>
      </footer>
    </div>
  );
}

function Figure({ value, label }: { value: number; label: string }) {
  return (
    <div className="bg-card px-6 py-5">
      <dd className="tnum text-3xl font-bold tracking-tight">{value}</dd>
      <dt className="mt-1 text-xs text-muted-foreground">{label}</dt>
    </div>
  );
}

function Section({
  eyebrow,
  title,
  lede,
  children,
}: {
  eyebrow: string;
  title: string;
  lede: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6">
      <Reveal className="max-w-2xl">
        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-verified">
          {eyebrow}
        </p>
        <h2 className="mt-3 text-balance text-2xl font-bold tracking-tight sm:text-3xl">
          {title}
        </h2>
        <p className="mt-3 text-pretty text-muted-foreground">{lede}</p>
      </Reveal>
      <div className="mt-8">{children}</div>
    </section>
  );
}

function Party({
  role,
  body,
  delay = 0,
}: {
  role: string;
  body: string;
  delay?: number;
}) {
  return (
    <Reveal delay={delay} className="rounded-lg border border-border bg-card p-5">
      <h3 className="font-semibold">{role}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {body}
      </p>
    </Reveal>
  );
}

function Note({
  icon,
  title,
  body,
  delay = 0,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  delay?: number;
}) {
  return (
    <Reveal delay={delay} className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        {icon}
        <h3 className="font-semibold">{title}</h3>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {body}
      </p>
    </Reveal>
  );
}
