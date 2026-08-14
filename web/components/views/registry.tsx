"use client";

import Link from "next/link";
import { ArrowRight, BadgeCheck, ExternalLink } from "lucide-react";
import { ApplyPanel } from "@/components/issuer-onboarding";
import { FieldLabel } from "@/components/primitives";
import { Card, CardContent } from "@/components/ui/card";
import { useApplications } from "@/lib/queries";
import { useIsRegistryAdmin, useRegistryAdmin } from "@/lib/registry";
import { useWallet } from "@/lib/wallet";
import { addresses, contractsConfigured } from "@/lib/contracts";
import { truncateHex } from "@/lib/format";

/**
 * The issuer registry.
 *
 * Membership is a contract, not a list this app maintains. Admitted issuers are
 * shown from applications the chain has confirmed. This page is for the company
 * applying and for anyone checking who was admitted; the admin's queue is a
 * different job and lives at /admin.
 */
export function RegistryView() {
  const admin = useRegistryAdmin();
  const approved = useApplications("APPROVED");

  return (
    <div>
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Issuer registry
        </h1>
        <p className="mt-1 max-w-2xl text-muted-foreground">
          Only addresses in this registry can create notes.{" "}
          <code className="font-mono text-sm">NoteFactory</code> checks
          membership on every mint and reverts otherwise.
        </p>
      </header>

      {contractsConfigured ? (
        <Card className="mb-8">
          <CardContent className="space-y-2 text-sm">
            <Row
              label="Registry"
              value={
                <a
                  href={`https://www.oklink.com/xlayer-test/address/${addresses.issuerRegistry}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 font-mono text-xs hover:text-verified"
                >
                  {truncateHex(addresses.issuerRegistry!, 8, 6)}
                  <ExternalLink className="size-3" />
                </a>
              }
            />
            <Row
              label="Admin"
              value={
                <code className="font-mono text-xs">
                  {admin.data ? truncateHex(admin.data, 8, 6) : "reading…"}
                </code>
              }
            />
            <Row label="Network" value="X Layer testnet (1952)" />
          </CardContent>
        </Card>
      ) : (
        <Card className="mb-8">
          <CardContent className="text-sm text-muted-foreground">
            No registry address configured. Set{" "}
            <code className="font-mono text-xs">
              NEXT_PUBLIC_ISSUER_REGISTRY_ADDRESS
            </code>{" "}
            — the deployed values are in{" "}
            <code className="font-mono text-xs">
              contracts/deployments/xlayer-testnet.json
            </code>
            .
          </CardContent>
        </Card>
      )}

      <ApplyPanel />
      <AdminLink />

      <section className="mt-8">
        <FieldLabel>Admitted issuers</FieldLabel>
        {approved.data?.length ? (
          <ul className="mt-3 space-y-2">
            {approved.data.map((issuer) => (
              <li
                key={issuer.id}
                className="flex flex-col gap-1 rounded-lg border border-border bg-card px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4"
              >
                <BadgeCheck className="size-4 shrink-0 text-verified" />
                <span className="font-medium">{issuer.companyName}</span>
                <span className="text-sm text-muted-foreground">
                  {issuer.jurisdiction}
                </span>
                <code className="font-mono text-xs break-all text-muted-foreground sm:ml-auto">
                  {issuer.walletAddress}
                </code>
              </li>
            ))}
          </ul>
        ) : (
          <Card className="mt-3">
            <CardContent className="text-sm text-muted-foreground">
              {approved.isError
                ? "The extraction service is unreachable, so the list of admitted issuers cannot be shown. Registry membership itself is unaffected — it is enforced on-chain."
                : "None yet."}
            </CardContent>
          </Card>
        )}
      </section>

      <Card className="mt-8">
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            <strong className="text-foreground">What this layer does.</strong>{" "}
            It controls who may issue. The on-chain enforcement is real — an
            unregistered address genuinely cannot mint.
          </p>
          <p>
            <strong className="text-foreground">What it does not do.</strong> It
            says nothing about whether any particular loan is sound. A reputable
            company can originate a bad loan. Every individual asset still goes
            through AI extraction, deterministic validation, and human review,
            and the credit risk of the loan itself remains entirely with the
            investor.
          </p>
          <p>
            <strong className="text-foreground">How admission works.</strong>{" "}
            A company applies with corporate detail held off-chain; the registry
            admin admits them by signing a transaction from their own wallet.
            Judging an application is a human decision — there is no KYB
            integration behind it.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/** Shown only to the wallet the registry contract names as admin. */
function AdminLink() {
  const { address } = useWallet();
  const { isAdmin } = useIsRegistryAdmin(address);
  if (!isAdmin) return null;

  return (
    <Card className="mt-6">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">
          This wallet is the registry admin.
        </span>
        <Link
          href="/app?view=admin"
          className="inline-flex items-center gap-1.5 font-medium hover:text-verified"
        >
          Open the queue <ArrowRight className="size-3.5" />
        </Link>
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <FieldLabel>{label}</FieldLabel>
      <span className="text-right">{value}</span>
    </div>
  );
}
