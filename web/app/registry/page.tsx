import { BadgeCheck, ShieldOff } from "lucide-react";
import { FieldLabel, Stamp } from "@/components/primitives";
import { Card, CardContent } from "@/components/ui/card";
import { REGISTERED_ISSUERS, UNVERIFIED } from "@/lib/mock-data";

export const metadata = { title: "Issuer registry · TokenForge" };

/**
 * The registry, shown as what it is: a list of addresses allowed to mint.
 *
 * Deliberately not dressed up with KYB pipelines or AML states — admission is a
 * manual off-chain decision in this prototype, and the page says so rather than
 * implying an integration that does not exist.
 */
export default function RegistryPage() {
  return (
    <div className="mx-auto max-w-[900px] px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Issuer registry</h1>
        <p className="mt-1 max-w-2xl text-muted-foreground">
          Only addresses in this registry can create notes.{" "}
          <code className="font-mono text-sm">NoteFactory</code> checks
          membership on every mint and reverts otherwise.
        </p>
      </header>

      <section>
        <FieldLabel>Admitted issuers</FieldLabel>
        <ul className="mt-3 space-y-2">
          {REGISTERED_ISSUERS.map((issuer) => (
            <li
              key={issuer.address}
              className="flex flex-col gap-1 rounded-lg border border-border bg-card px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4"
            >
              <BadgeCheck className="size-4 shrink-0 text-verified" />
              <span className="font-medium">{issuer.name}</span>
              <span className="text-sm text-muted-foreground">
                {issuer.jurisdiction}
              </span>
              <code className="font-mono text-xs break-all text-muted-foreground sm:ml-auto">
                {issuer.address}
              </code>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <FieldLabel>Not admitted</FieldLabel>
        <ul className="mt-3">
          <li className="flex flex-col gap-1 rounded-lg border border-border bg-card px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4">
            <ShieldOff className="size-4 shrink-0 text-impaired" />
            <span className="font-medium">{UNVERIFIED.name}</span>
            <Stamp tone="impaired">Mint reverts</Stamp>
            <code className="font-mono text-xs break-all text-muted-foreground sm:ml-auto">
              {UNVERIFIED.address}
            </code>
          </li>
        </ul>
      </section>

      <Card className="mt-8">
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            <strong className="text-foreground">
              What this layer does.
            </strong>{" "}
            It controls who may issue. The on-chain enforcement is real — an
            unregistered address genuinely cannot mint.
          </p>
          <p>
            <strong className="text-foreground">
              What it does not do.
            </strong>{" "}
            It says nothing about whether any particular loan is sound. A
            reputable company can originate a bad loan. Every individual asset
            still goes through AI extraction, deterministic validation, and
            human review, and the credit risk of the loan itself remains
            entirely with the investor.
          </p>
          <p>
            <strong className="text-foreground">How admission works.</strong>{" "}
            Manually, off-chain, in this prototype. There is no KYB integration
            behind this list.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
