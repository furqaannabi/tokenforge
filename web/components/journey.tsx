"use client";

import { Reveal } from "@/components/reveal";
import { cn } from "@/lib/utils";

/**
 * The whole life of a loan, in the order it happens.
 *
 * The page previously stopped at the mint, which is the point most tokenization
 * pitches stop at — and it is the least interesting half. A note that nobody
 * repays is a JPEG of a loan. So the journey runs from the paper being signed
 * through to the last instalment settling, and every step says who acts.
 *
 * Who acts is the load-bearing column. The whole design rests on the three
 * parties being distinct — the issuer cannot accept on the borrower's behalf,
 * the platform cannot move a holder's money, the keeper cannot take anything —
 * and a flow diagram that omits the actor quietly implies one party does it all.
 */

type Actor = "Borrower" | "Issuer" | "Platform" | "Admin" | "Holders" | "Chain";

/** Each actor keeps one colour everywhere it appears. */
const ACTOR_TONE: Record<Actor, string> = {
  Issuer: "border-verified/40 bg-verified/10 text-verified",
  Borrower: "border-review/40 bg-review/10 text-review",
  Holders: "border-sky-400/40 bg-sky-400/10 text-sky-300",
  Platform: "border-border bg-muted text-muted-foreground",
  Admin: "border-border bg-muted text-muted-foreground",
  Chain: "border-border bg-muted text-muted-foreground",
};

interface Step {
  phase?: string;
  actor: Actor;
  title: string;
  body: string;
  /** Rendered in mono — a function, a status, the thing you could verify. */
  proof?: string;
}

const STEPS: Step[] = [
  {
    phase: "The paper",
    actor: "Issuer",
    title: "A loan is signed off-chain",
    body: "Two real parties agree real terms. Nothing that follows changes them — the platform describes this agreement, it does not create it.",
  },
  {
    actor: "Issuer",
    title: "The agreement is uploaded and hashed",
    body: "The PDF is stored and fingerprinted. That hash is what the note commits to on-chain, so the token can always name the paper it came from.",
    proof: "keccak256(document)",
  },
  {
    phase: "Verification",
    actor: "Platform",
    title: "A model reads the economic terms",
    body: "Principal, rate, maturity and every instalment — each returned with its own confidence rather than one score for the document.",
    proof: "Gemini 3.7 Flash",
  },
  {
    actor: "Platform",
    title: "A validator checks the arithmetic",
    body: "Rules, not a model: does the schedule sum to the principal, does the interest follow the rate, do the dates run in order.",
    proof: "deterministic",
  },
  {
    actor: "Platform",
    title: "Provenance is checked",
    body: "Two questions a hash cannot answer — does this document actually name this issuer as the lender, and has the same agreement been through here before.",
  },
  {
    actor: "Admin",
    title: "A human reviews anything shaky",
    body: "Every field the model was unsure of is put in front of a person before it can go further. Nothing low-confidence reaches a chain unread.",
    proof: "confidence < 0.90",
  },
  {
    phase: "Issuance",
    actor: "Admin",
    title: "An admin approves the exact parameters",
    body: "Approval commits to a hash of every value — name, supply, borrower, schedule. The interface cannot alter a single field afterwards; the contract simply refuses anything that does not match.",
    proof: "registry.approveMint(hash)",
  },
  {
    actor: "Issuer",
    title: "The issuer mints the note",
    body: "An ERC-20 note and its repayment vault are deployed together. The note opens Pending: it cannot be transferred, sold or repaid yet.",
    proof: "status: Pending",
  },
  {
    actor: "Borrower",
    title: "The borrower accepts",
    body: "Until the named wallet signs, a minted note is only the issuer's assertion about somebody else. Nobody can do this on their behalf — not the issuer, not the platform.",
    proof: "note.accept()",
  },
  {
    phase: "Distribution",
    actor: "Issuer",
    title: "Part of the supply is offered",
    body: "The issuer chooses how much to sell and can pull unsold tokens back at any time. The price is par, computed by the contract — nobody types a number.",
    proof: "0.25% each side",
  },
  {
    actor: "Holders",
    title: "Investors buy in",
    body: "Settlement currency goes to the issuer, note tokens to the buyer. From here the repayments belong to whoever holds the tokens.",
  },
  {
    phase: "Servicing",
    actor: "Borrower",
    title: "The borrower arms automatic repayment",
    body: "A standing allowance to the vault, and nothing more. Lower it and collection stops on the next block — no counterparty, no notice period, nobody to ask.",
    proof: "approve(vault, amount)",
  },
  {
    actor: "Chain",
    title: "Each instalment collects itself",
    body: "Once a due date passes, a keeper pulls exactly the scheduled amount. The call names no recipient and takes nothing else, which is why anyone is allowed to make it.",
    proof: "collectFromBorrower()",
  },
  {
    actor: "Holders",
    title: "Holders are paid as it repays",
    body: "Every settlement credits holders pro rata. Balances fall as principal comes back — that is repayment arriving, not a loss — while shares, which measure ownership, never move.",
    proof: "claim()",
  },
  {
    phase: "Close",
    actor: "Chain",
    title: "The last period settles",
    body: "Principal reaches zero, the note matures, and the whole history — every term, every payment, every holder — stays readable on-chain.",
    proof: "status: Matured",
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
          Fifteen steps, and the party responsible for each. No step trusts the
          one before it.
        </p>
      </Reveal>

      <ol className="relative mt-10">
        {/*
          The rail. Absolute and behind the rows so it never affects layout,
          and it stops short of the last dot rather than trailing into nothing.
        */}
        <div
          aria-hidden
          className="absolute bottom-8 left-[15px] top-2 w-px bg-gradient-to-b from-verified/50 via-border to-transparent sm:left-[19px]"
        />

        {STEPS.map((step, index) => (
          <Row key={step.title} step={step} index={index} />
        ))}
      </ol>
    </section>
  );
}

function Row({ step, index }: { step: Step; index: number }) {
  return (
    <>
      {step.phase ? (
        <Reveal as="li" className="relative ml-11 pb-3 pt-7 sm:ml-14">
          <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
            {step.phase}
          </span>
        </Reveal>
      ) : null}

      <Reveal
        as="li"
        /* Capped, because a stagger that keeps growing leaves the last rows
           visibly waiting after the reader has arrived at them. */
        delay={Math.min(index, 6) * 60}
        className="relative pb-6 pl-11 sm:pl-14"
      >
        <span
          aria-hidden
          className="absolute left-0 top-0.5 flex size-8 items-center justify-center rounded-full border border-border bg-card font-mono text-[11px] text-muted-foreground sm:size-10 sm:text-xs"
        >
          {String(index + 1).padStart(2, "0")}
        </span>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className="font-semibold leading-tight">{step.title}</h3>
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em]",
              ACTOR_TONE[step.actor],
            )}
          >
            {step.actor}
          </span>
        </div>

        <p className="mt-1.5 max-w-2xl text-pretty text-sm leading-relaxed text-muted-foreground">
          {step.body}
        </p>

        {step.proof ? (
          <code className="mt-2 inline-block rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
            {step.proof}
          </code>
        ) : null}
      </Reveal>
    </>
  );
}
