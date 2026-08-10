"use client";

import { BadgeCheck, ExternalLink, ShieldOff } from "lucide-react";
import { AdminQueue } from "@/components/issuer-onboarding";
import { FieldLabel, Stamp } from "@/components/primitives";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useApplications } from "@/lib/queries";
import { useIsRegistryAdmin } from "@/lib/registry";
import { useWallet } from "@/lib/wallet";
import { addresses } from "@/lib/contracts";
import { shortDate, truncateHex } from "@/lib/format";
import type { ApiIssuerApplication } from "@/lib/api";

/**
 * The registry admin's screen.
 *
 * Separate from `/registry` because the two audiences want opposite things: a
 * company wants to apply and see whether it was admitted, while the admin wants
 * a queue to work through. Mixing them left the admin's controls hidden inside
 * a page written to explain the registry to outsiders.
 *
 * Every decision here is a transaction from the admin's own wallet. The service
 * is told afterwards, and only for the record — it cannot admit anyone.
 */
export default function AdminPage() {
  const { address, connected } = useWallet();
  const { isAdmin, admin, isPending } = useIsRegistryAdmin(address);

  const pending = useApplications("PENDING");
  const approved = useApplications("APPROVED");
  const rejected = useApplications("REJECTED");

  if (!connected) {
    return (
      <Locked
        title="Connect the admin wallet"
        body="This screen reads the registry's admin from the contract and shows the queue only to that address."
      />
    );
  }

  if (isPending) {
    return <Locked title="Checking the registry…" body="Reading the admin address from the contract." />;
  }

  if (!isAdmin) {
    return (
      <Locked
        title="Not the registry admin"
        body={`Admission is restricted on-chain to ${
          admin ? truncateHex(admin, 8, 6) : "the registry's admin"
        }. Connecting a different wallet would not help — IssuerRegistry.admitIssuer reverts for anyone else.`}
      />
    );
  }

  return (
    <div className="mx-auto max-w-[1000px] px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Registry admin
        </h1>
        <p className="mt-1 max-w-2xl text-muted-foreground">
          Admitting an issuer lets it mint notes. Judging an application is a
          human decision — there is no KYB integration behind this queue.
        </p>
      </header>

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Count label="Awaiting decision" value={pending.data?.length} tone="review" />
        <Count label="Admitted" value={approved.data?.length} tone="verified" />
        <Count label="Declined" value={rejected.data?.length} />
      </div>

      <AdminQueue />

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">Decisions</h2>
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Company</TableHead>
                <TableHead>Jurisdiction</TableHead>
                <TableHead>Wallet</TableHead>
                <TableHead>Decided</TableHead>
                <TableHead>Outcome</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {decided(approved.data, rejected.data).length ? (
                decided(approved.data, rejected.data).map((application) => (
                  <TableRow key={application.id}>
                    <TableCell className="font-medium">
                      {application.companyName}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {application.jurisdiction}
                    </TableCell>
                    <TableCell>
                      <code className="font-mono text-xs text-muted-foreground">
                        {truncateHex(application.walletAddress, 6, 4)}
                      </code>
                    </TableCell>
                    <TableCell className="tnum text-muted-foreground">
                      {application.decidedAt
                        ? shortDate(application.decidedAt)
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {application.status === "APPROVED" ? (
                        <Stamp tone="verified">
                          <BadgeCheck /> Admitted
                        </Stamp>
                      ) : (
                        <Stamp tone="impaired">
                          <ShieldOff /> Declined
                        </Stamp>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-8 text-center text-sm text-muted-foreground"
                  >
                    Nothing decided yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      </section>

      <Card className="mt-8">
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
                {addresses.issuerRegistry
                  ? truncateHex(addresses.issuerRegistry, 8, 6)
                  : "not configured"}
                <ExternalLink className="size-3" />
              </a>
            }
          />
          <Row
            label="Admin"
            value={
              <code className="font-mono text-xs">
                {admin ? truncateHex(admin, 8, 6) : "—"}
              </code>
            }
          />
          <p className="border-t border-border pt-3 text-xs text-muted-foreground">
            Admission controls who may issue. It says nothing about whether any
            particular loan is sound — every asset still goes through extraction,
            validation, and review, and credit risk stays with the investor.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/** Approved and rejected together, newest decision first. */
function decided(
  approved?: ApiIssuerApplication[],
  rejected?: ApiIssuerApplication[],
): ApiIssuerApplication[] {
  return [...(approved ?? []), ...(rejected ?? [])].sort((a, b) =>
    (b.decidedAt ?? "").localeCompare(a.decidedAt ?? ""),
  );
}

function Count({
  label,
  value,
  tone,
}: {
  label: string;
  value?: number;
  tone?: "review" | "verified";
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <FieldLabel className="block">{label}</FieldLabel>
      <p
        className={`tnum mt-1 text-2xl font-semibold ${
          tone === "review" && value
            ? "text-review"
            : tone === "verified"
              ? "text-verified"
              : ""
        }`}
      >
        {value ?? "—"}
      </p>
    </div>
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

function Locked({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto max-w-[600px] px-4 py-16 text-center sm:px-6">
      <ShieldOff className="mx-auto size-6 text-muted-foreground" />
      <h1 className="mt-3 text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
