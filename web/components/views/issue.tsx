"use client";

import { useState } from "react";
import { BadgeCheck, ShieldOff, Trash2, Wallet } from "lucide-react";
import { useWallet } from "@/lib/wallet";
import { X_LAYER_TESTNET } from "@/lib/wagmi";
import { useDeleteExtraction, useExtractions } from "@/lib/queries";
import { money, percent, monthYear, truncateHex } from "@/lib/format";
import Link from "next/link";
import { FieldLabel, Stamp } from "@/components/primitives";
import type { ApiExtractionSummary } from "@/lib/api";
import { UploadPanel } from "@/components/upload-panel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function IssueView() {
  const { issuer, connected, address } = useWallet();
  const extractions = useExtractions();

  /*
   * This tab is the issuer's own desk, so it shows their own work. Pending ones
   * are matched on who uploaded the document; minted ones on the issuer the
   * factory recorded, which is the only claim that survives the database.
   */
  const mine = (value?: string | null) =>
    Boolean(address) && value?.toLowerCase() === address!.toLowerCase();

  const pending =
    extractions.data?.filter(
      (e) => e.status !== "MINTED" && mine(e.document?.uploadedBy),
    ) ?? [];
  const notes =
    extractions.data?.filter(
      (e) => e.status === "MINTED" && mine(e.note?.issuerAddress),
    ) ?? [];

  return (
    <div>
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Issue a note</h1>
        <p className="mt-1 text-muted-foreground">
          Upload a loan agreement, invoice, or bond term sheet. Terms are
          extracted, validated, and reviewed before anything is minted.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        {!connected ? (
          <NotConnected />
        ) : issuer?.verified ? (
          <UploadPanel />
        ) : (
          <IssuanceBlocked address={issuer?.address} />
        )}
        <IssuerPanel />
      </div>


      {pending.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-1 text-lg font-semibold">Pending</h2>
          <p className="mb-3 text-sm text-muted-foreground">
            Extracted but not yet on-chain. Nothing here is permanent — a bad
            scan or a document you did not mean to upload can be discarded.
          </p>
          <Card className="py-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Document</TableHead>
                  <TableHead className="text-right">Principal</TableHead>
                  <TableHead>Maturity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((extraction) => (
                  <PendingRow key={extraction.id} extraction={extraction} />
                ))}
              </TableBody>
            </Table>
          </Card>
        </section>
      ) : null}

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">Your notes</h2>
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Note</TableHead>
                <TableHead className="text-right">Principal</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead>Maturity</TableHead>
                <TableHead>Token</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {notes.length ? (
                notes.map((extraction) => (
                  <NoteRow key={extraction.id} extraction={extraction} />
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-8 text-center text-sm text-muted-foreground"
                  >
                    {extractions.isError
                      ? "The extraction service is unreachable."
                      : extractions.isPending
                        ? "Loading…"
                        : "No notes minted yet."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      </section>
    </div>
  );
}

/**
 * One extraction still waiting on someone.
 *
 * Deleting is offered because an upload is not a commitment — a rescan, a
 * duplicate, a document that failed validation and will be replaced. The
 * service refuses to delete a minted one: the note exists on chain whatever
 * this table says, and removing the record would leave nothing to explain what
 * the token is.
 */
function PendingRow({ extraction }: { extraction: ApiExtractionSummary }) {
  const { terms, status } = extraction;
  const remove = useDeleteExtraction();
  const [confirming, setConfirming] = useState(false);

  return (
    <TableRow>
      <TableCell className="font-medium">
        {extraction.document?.filename ?? "Document"}
      </TableCell>
      <TableCell className="tnum text-right">
        {money(terms.principal.value)}
      </TableCell>
      <TableCell className="tnum">
        {monthYear(terms.maturityDate.value)}
      </TableCell>
      <TableCell>
        <Stamp
          tone={
            status === "INVALID"
              ? "impaired"
              : status === "VALIDATED"
                ? "verified"
                : "review"
          }
        >
          {status === "NEEDS_REVIEW"
            ? "Needs review"
            : status === "VALIDATED"
              ? "Ready to mint"
              : status.charAt(0) + status.slice(1).toLowerCase()}
        </Stamp>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-3">
          <Link
            href={`/review/${extraction.id}`}
            className="text-sm hover:text-verified"
          >
            {status === "VALIDATED" ? "Mint" : "Review"}
          </Link>

          {confirming ? (
            <span className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => remove.mutate(extraction.id)}
                disabled={remove.isPending}
                className="text-xs text-impaired hover:underline"
              >
                {remove.isPending ? "Deleting…" : "Confirm"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              aria-label={`Delete ${extraction.document?.filename ?? "extraction"}`}
              className="text-muted-foreground transition-colors hover:text-impaired"
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

/**
 * One minted note.
 *
 * Everything here is settled: the terms were reviewed, the mint was signed, and
 * a token exists. The row links to the note page, which reads live state from
 * the chain — balances amortize as principal comes back, so the figures below
 * describe the loan as written, not what is outstanding today.
 */
function NoteRow({ extraction }: { extraction: ApiExtractionSummary }) {
  const { terms, note } = extraction;

  return (
    <TableRow>
      <TableCell className="font-medium">
        {note?.name ?? extraction.document?.filename ?? "Note"}
      </TableCell>
      <TableCell className="tnum text-right">
        {money(terms.principal.value)}
      </TableCell>
      <TableCell className="tnum text-right">
        {percent(terms.interestRatePct.value)}
      </TableCell>
      <TableCell className="tnum">
        {monthYear(terms.maturityDate.value)}
      </TableCell>
      <TableCell>
        <Stamp tone="neutral">{note?.symbol ?? "—"}</Stamp>
      </TableCell>
      <TableCell className="text-right">
        <Link
          href={`/note/${extraction.id}`}
          className="text-sm hover:text-verified"
        >
          View
        </Link>
      </TableCell>
    </TableRow>
  );
}

function NotConnected() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect a wallet</CardTitle>
        <CardDescription>
          Issuing a note is an on-chain action signed by an authorized
          representative, so a connected wallet comes first.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border border-dashed border-input px-6 py-10 text-center">
          <Wallet className="mx-auto size-6 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">No wallet connected</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Use the connect button above. The network is X Layer testnet.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Refusal beat: an address outside the registry never reaches extraction. The
 * gate is enforced on-chain by NoteFactory; stopping here just avoids wasting
 * the reviewer's time on terms that could never be minted.
 */
function IssuanceBlocked({ address }: { address?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload document</CardTitle>
      </CardHeader>
      <CardContent>
        <Alert className="border-impaired/40 bg-impaired/10">
          <ShieldOff className="text-impaired" />
          <AlertTitle className="text-impaired">
            This wallet is not a registered issuer
          </AlertTitle>
          <AlertDescription className="space-y-3">
            <p>
              {address ? (
                <code className="font-mono text-xs">{address}</code>
              ) : (
                "The connected wallet"
              )}{" "}
              is not in the issuer registry, so it cannot create notes.
              <code className="mx-1 font-mono text-xs">NoteFactory.mint</code>
              reverts for unregistered addresses — the check is on-chain, not in
              this interface.
            </p>
            <p>
              Admission is a manual off-chain decision in this prototype, not a
              KYB integration. Switch to the verified wallet to continue.
            </p>
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}

function IssuerPanel() {
  const { issuer, chainId, wrongNetwork } = useWallet();
  if (!issuer) return null;

  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {issuer.verified ? (
            <BadgeCheck className="size-4 text-verified" />
          ) : (
            <ShieldOff className="size-4 text-impaired" />
          )}
          Issuer verification
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <Row label="Entity" value={issuer.name} />
        <Row label="Jurisdiction" value={issuer.jurisdiction} />
        <Row
          label="Registry"
          value={
            <span
              className={issuer.verified ? "text-verified" : "text-impaired"}
            >
              {issuer.verified ? "Admitted" : "Not admitted"}
            </span>
          }
        />
        <Row
          label="Network"
          value={
            wrongNetwork ? (
              <span className="text-review">
                Chain {chainId} — switch to X Layer testnet
              </span>
            ) : (
              `${X_LAYER_TESTNET.name} (${chainId})`
            )
          }
        />
        <Row
          label="Address"
          value={
            <code className="font-mono text-xs">
              {truncateHex(issuer.address, 6, 4)}
            </code>
          }
        />
        <p className="border-t border-border pt-3 text-xs text-muted-foreground">
          Registry membership controls who may issue. It is not a judgement on
          any particular loan — credit risk stays with the investor.
        </p>
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
