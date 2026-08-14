"use client";

import { ChevronRight, CornerDownLeft } from "lucide-react";
import { Reveal } from "@/components/reveal";
import { cn } from "@/lib/utils";

/**
 * The whole life of a loan, as a flow rather than a list.
 *
 * This was a column of stacked rows with a paragraph each, which was accurate
 * and
 * far too tall — a reader had to scroll through the entire mechanism to reach
 * the end of it. Grouped into phases, one line per step, it fits in about a
 * screen and still says the same thing.
 *
 * What survived the compression is the actor on every step. The design rests
 * on the three parties being distinct — the issuer cannot accept for the
 * borrower, the platform cannot move a holder's money, the keeper cannot take
 * anything — and a diagram that drops the actor quietly implies one party does
 * it all. The prose went; that did not.
 */

type Actor = "Borrower" | "Issuer" | "Platform" | "Admin" | "Holders" | "Chain";

/** One colour per actor, everywhere it appears. */
const ACTOR_TONE: Record<Actor, string> = {
  Issuer: "bg-verified",
  Borrower: "bg-review",
  Holders: "bg-sky-400",
  Platform: "bg-muted-foreground",
  Admin: "bg-muted-foreground",
  Chain: "bg-muted-foreground",
};

interface Step {
  actor: Actor;
  title: string;
  /** A call or status you could go and verify. */
  proof?: string;
}

interface Phase {
  name: string;
  caption: string;
  steps: Step[];
}

const PHASES: Phase[] = [
  {
    name: "The paper",
    caption: "A real agreement, described — not created.",
    steps: [
      { actor: "Issuer", title: "A loan is signed off-chain" },
      {
        actor: "Issuer",
        title: "The agreement is uploaded and hashed",
        proof: "keccak256",
      },
    ],
  },
  {
    name: "Verification",
    caption: "Four checks, none trusting the one before it.",
    steps: [
      { actor: "Platform", title: "A model reads the terms", proof: "per-field confidence" },
      { actor: "Platform", title: "A validator checks the arithmetic", proof: "deterministic" },
      { actor: "Platform", title: "Provenance: right issuer, not a duplicate" },
      { actor: "Admin", title: "A human reviews anything shaky", proof: "< 0.90" },
    ],
  },
  {
    name: "Issuance",
    caption: "Nobody mints until the borrower has agreed.",
    steps: [
      {
        actor: "Issuer",
        title: "The issuer submits the intended terms",
        proof: "mintHash",
      },
      {
        actor: "Borrower",
        title: "The borrower signs those exact terms",
        proof: "signature over the hash",
      },
      {
        actor: "Admin",
        title: "An admin approves and registers the borrower",
        proof: "approveMint(hash)",
      },
      { actor: "Issuer", title: "The issuer mints the note", proof: "note + vault" },
    ],
  },
  {
    name: "Distribution",
    caption: "Sold at par, priced by the contract.",
    steps: [
      { actor: "Issuer", title: "Part of the supply is offered", proof: "0.25% each side" },
      { actor: "Holders", title: "Investors buy in" },
    ],
  },
  {
    name: "Servicing",
    caption: "Repayment that does not wait to be remembered.",
    steps: [
      { actor: "Borrower", title: "Automatic repayment is armed", proof: "approve(vault)" },
      { actor: "Chain", title: "Each instalment collects itself", proof: "collectFromBorrower()" },
      { actor: "Holders", title: "Holders are paid pro rata", proof: "claim()" },
    ],
  },
  {
    name: "Close",
    caption: "Principal at zero, the history still readable.",
    steps: [{ actor: "Chain", title: "The last period settles", proof: "status: Matured" }],
  },
];

export function Journey() {
  return (
    <section className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6">
      <Reveal className="max-w-2xl">
        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-verified">
          The loan journey
        </p>
        <h2 className="mt-3 text-balance text-2xl font-bold tracking-tight sm:text-3xl">
          From a signed agreement to the final instalment
        </h2>
        <p className="mt-3 text-pretty text-muted-foreground">
          Six phases, and the party responsible for every step.
        </p>
      </Reveal>

      <div className="mt-10 grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
        {PHASES.map((phase, index) => (
            <PhaseCard
              key={phase.name}
              phase={phase}
              order={index + 1}
              delay={index * 90}
              /* Three across at lg: every third card ends a row, so it gets a
                 wrap marker instead of an arrow into the margin. */
              connect={
                index === PHASES.length - 1
                  ? "none"
                  : index % 3 === 2
                    ? "wrap"
                    : "across"
              }
            />
        ))}
      </div>
    </section>
  );
}

function PhaseCard({
  phase,
  order,
  delay,
  connect,
}: {
  phase: Phase;
  /** Which phase this is, 1-based. The primary signal of order. */
  order: number;
  delay: number;
  connect: "across" | "wrap" | "none";
}) {
  return (
    <Reveal delay={delay} className="relative">
      {/*
        The connector, drawn into the gutter between columns. Hidden below lg
        because at one and two columns the cards no longer sit in the order the
        line would claim.
      */}
      {connect === "across" ? (
        <span
          aria-hidden
          className="absolute -right-6 top-9 hidden items-center lg:flex"
        >
          <span className="h-px w-4 bg-verified/50" />
          <ChevronRight className="-ml-1 size-3.5 text-verified/70" />
        </span>
      ) : null}

      {/*
        The wrap. Without it the eye reaches the right edge of the first row
        and has no reason to believe the next phase is at the far left of the
        second — the one place the line genuinely could not help.
      */}
      {connect === "wrap" ? (
        <span
          aria-hidden
          className="absolute -bottom-6 left-6 hidden items-center gap-1 lg:flex"
        >
          <CornerDownLeft className="size-3.5 text-verified/70" />
          <span className="font-mono text-[10px] text-muted-foreground">
            continues below
          </span>
        </span>
      ) : null}

      <div className="h-full rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-2.5">
          {/*
            The phase number carries the order on its own. A connecting line
            can only suggest sequence, and it suggests the wrong one the moment
            the grid wraps to a second row — which is exactly where a reader
            was losing the thread.
          */}
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-verified/30 bg-verified/10 font-mono text-xs font-semibold text-verified">
            {order}
          </span>
          <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-verified">
            {phase.name}
          </span>
        </div>

        <p className="mt-1.5 text-xs text-muted-foreground">{phase.caption}</p>

        <ol className="mt-4 space-y-2.5">
          {phase.steps.map((step, index) => (
            <li key={step.title} className="flex gap-2.5">
              <span className="relative mt-[7px] flex shrink-0">
                <span
                  className={cn("size-1.5 rounded-full", ACTOR_TONE[step.actor])}
                />
                {/* The rail between steps within a phase. */}
                {index < phase.steps.length - 1 ? (
                  <span
                    aria-hidden
                    className="absolute left-[2.5px] top-2.5 h-[calc(100%+0.9rem)] w-px bg-border"
                  />
                ) : null}
              </span>

              <div className="min-w-0">
                <p className="text-sm leading-snug">{step.title}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                    {step.actor}
                  </span>
                  {step.proof ? (
                    <code className="rounded border border-border bg-muted px-1 py-px font-mono text-[10px] text-muted-foreground">
                      {step.proof}
                    </code>
                  ) : null}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </Reveal>
  );
}
