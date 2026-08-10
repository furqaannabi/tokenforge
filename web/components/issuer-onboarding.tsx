"use client";

import { useState } from "react";
import { BadgeCheck, CircleAlert, ExternalLink, Loader2, ShieldOff } from "lucide-react";
import { FieldLabel, Stamp } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useApplications,
  useApply,
  useMyApplication,
  useRecordAdmission,
  useRejectApplication,
} from "@/lib/queries";
import { useAdmitIssuer, useIsRegistryAdmin } from "@/lib/registry";
import { useWallet } from "@/lib/wallet";
import { truncateHex } from "@/lib/format";
import type { ApiIssuerApplication } from "@/lib/api";

/**
 * Issuer onboarding.
 *
 * Two halves that meet in the middle. An applicant fills in corporate detail
 * that is stored off-chain, because a public chain is no place for contact
 * addresses and the record of companies that were turned down. An admin then
 * admits them by signing `IssuerRegistry.admitIssuer` from their own wallet —
 * the service is told afterwards, and never gets to admit anyone itself.
 */

// ---------------------------------------------------------------------------
// Applicant
// ---------------------------------------------------------------------------

export function ApplyPanel() {
  const { address, connected, issuer } = useWallet();
  const existing = useMyApplication(address);
  const apply = useApply();

  const [form, setForm] = useState({
    companyName: "",
    jurisdiction: "",
    registrationNumber: "",
    contactEmail: "",
    website: "",
    description: "",
  });

  if (!connected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Apply to issue</CardTitle>
          <CardDescription>
            Connect the wallet that will mint. It is the address admitted to the
            registry, so it has to be the one applying.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // Already on-chain: nothing to apply for.
  if (issuer?.verified) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BadgeCheck className="size-4 text-verified" /> Admitted
          </CardTitle>
          <CardDescription>
            {issuer.name} is in the registry and can mint notes.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const application = existing.data;
  if (application && application.status === "PENDING") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Application received</CardTitle>
          <CardDescription>
            {application.companyName} is awaiting a decision from the registry
            admin. Admission is a transaction, so it will appear on-chain.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const submit = () => {
    if (!address) return;
    apply.mutate({
      walletAddress: address,
      companyName: form.companyName,
      jurisdiction: form.jurisdiction,
      registrationNumber: form.registrationNumber || null,
      contactEmail: form.contactEmail,
      website: form.website || null,
      description: form.description || null,
    });
  };

  const complete =
    form.companyName && form.jurisdiction && form.contactEmail.includes("@");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Apply to issue</CardTitle>
        <CardDescription>
          {application?.status === "REJECTED"
            ? "This application was declined. Correcting the details resubmits it."
            : "Corporate detail is held off-chain. The registry records only your address, name, and jurisdiction."}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="rounded border border-border bg-background px-3 py-2">
          <FieldLabel>Applying as</FieldLabel>
          <code className="mt-1 block font-mono text-xs break-all text-muted-foreground">
            {address}
          </code>
        </div>

        {(
          [
            ["companyName", "Company name", "Meridian Freight Holdings LLC"],
            ["jurisdiction", "Jurisdiction", "Delaware, USA"],
            ["registrationNumber", "Registration number", "Optional"],
            ["contactEmail", "Contact email", "treasury@example.com"],
            ["website", "Website", "Optional"],
          ] as const
        ).map(([key, label, placeholder]) => (
          <div key={key} className="space-y-1.5">
            <Label htmlFor={key}>{label}</Label>
            <Input
              id={key}
              value={form[key]}
              placeholder={placeholder}
              onChange={(event) =>
                setForm((f) => ({ ...f, [key]: event.target.value }))
              }
            />
          </div>
        ))}

        <div className="space-y-1.5">
          <Label htmlFor="description">What do you intend to tokenize?</Label>
          <textarea
            id="description"
            rows={3}
            value={form.description}
            onChange={(event) =>
              setForm((f) => ({ ...f, description: event.target.value }))
            }
            className="w-full rounded border border-input bg-background px-3 py-2 text-sm"
          />
        </div>

        {apply.isError ? (
          <p className="text-sm text-impaired">{(apply.error as Error).message}</p>
        ) : null}

        <Button
          className="w-full"
          disabled={!complete || apply.isPending}
          onClick={submit}
        >
          {apply.isPending ? (
            <>
              <Loader2 className="animate-spin" /> Submitting…
            </>
          ) : (
            "Submit application"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

/**
 * The admin queue.
 *
 * Only rendered for the address `IssuerRegistry.admin()` returns — and that is
 * a display decision, not a security one. The contract rejects `admitIssuer`
 * from anyone else regardless of what this interface shows.
 */
export function AdminQueue() {
  const { address } = useWallet();
  const { isAdmin, admin } = useIsRegistryAdmin(address);
  const pending = useApplications("PENDING");

  if (!isAdmin) return null;

  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Pending applications</h2>
        <span className="font-mono text-xs text-muted-foreground">
          admin {admin ? truncateHex(admin, 6, 4) : "—"}
        </span>
      </div>

      {pending.isError ? (
        <Card>
          <CardContent className="text-sm text-muted-foreground">
            {(pending.error as Error).message}
          </CardContent>
        </Card>
      ) : pending.data?.length ? (
        <ul className="space-y-3">
          {pending.data.map((application) => (
            <ApplicationRow key={application.id} application={application} />
          ))}
        </ul>
      ) : (
        <Card>
          <CardContent className="text-sm text-muted-foreground">
            Nothing waiting.
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function ApplicationRow({ application }: { application: ApiIssuerApplication }) {
  const { address } = useWallet();
  const admit = useAdmitIssuer();
  const record = useRecordAdmission();
  const reject = useRejectApplication();
  const [error, setError] = useState<string | null>(null);

  /**
   * Sign, wait, then record — in that order.
   *
   * The service is told only after the chain has accepted the transaction.
   * Recording on broadcast would mark an application approved on the strength
   * of something that could still revert, and the registry would disagree with
   * the queue.
   */
  const onAdmit = async () => {
    setError(null);
    try {
      const hash = await admit.admit(
        application.walletAddress,
        application.companyName,
        application.jurisdiction,
      );
      await record.mutateAsync({
        id: application.id,
        txHash: hash,
        decidedBy: address ?? null,
      });
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  const busy = admit.isSigning || admit.isConfirming || record.isPending;

  return (
    <li className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{application.companyName}</p>
          <p className="text-sm text-muted-foreground">
            {application.jurisdiction}
            {application.registrationNumber
              ? ` · ${application.registrationNumber}`
              : ""}
          </p>
          <code className="mt-1 block font-mono text-xs break-all text-muted-foreground">
            {application.walletAddress}
          </code>
        </div>
        <Stamp tone="review">Pending</Stamp>
      </div>

      {application.description ? (
        <p className="mt-3 border-t border-border pt-3 text-sm text-muted-foreground">
          {application.description}
        </p>
      ) : null}

      <p className="mt-3 text-xs text-muted-foreground">
        Admitting signs <code className="font-mono">admitIssuer</code> from your
        wallet. Nothing is recorded until the chain confirms it.
      </p>

      {error ? (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-impaired">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </p>
      ) : null}

      {admit.hash ? (
        <a
          href={`https://www.oklink.com/xlayer-test/tx/${admit.hash}`}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1.5 font-mono text-xs text-verified hover:underline"
        >
          {truncateHex(admit.hash, 10, 8)} <ExternalLink className="size-3" />
        </a>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={onAdmit} disabled={busy}>
          {admit.isSigning ? (
            <>
              <Loader2 className="animate-spin" /> Confirm in wallet…
            </>
          ) : admit.isConfirming ? (
            <>
              <Loader2 className="animate-spin" /> Waiting for the chain…
            </>
          ) : (
            <>
              <BadgeCheck /> Admit issuer
            </>
          )}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || reject.isPending}
          onClick={() =>
            reject.mutate({ id: application.id, decidedBy: address ?? null })
          }
        >
          <ShieldOff /> Decline
        </Button>
      </div>
    </li>
  );
}
