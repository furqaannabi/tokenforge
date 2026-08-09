"use client";

import Link from "next/link";
import { BadgeCheck, FileText, ShieldOff, Upload, Wallet } from "lucide-react";
import { useWallet } from "@/lib/wallet";
import { X_LAYER_TESTNET } from "@/lib/wagmi";
import { useNotes } from "@/lib/notes";
import { money, percent, monthYear, truncateHex } from "@/lib/format";
import { FieldLabel, StatusBadge } from "@/components/primitives";
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

export default function IssuerDashboard() {
  const { issuer, connected } = useWallet();
  const { notes } = useNotes();

  const pending = notes.filter((note) => note.status === "review");

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Issue a note</h1>
        <p className="mt-1 text-muted-foreground">
          Upload a loan agreement, invoice, or bond term sheet. Terms are
          extracted, validated, and reviewed before anything is minted.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        {!connected ? (
          <NotConnected />
        ) : issuer?.verified ? (
          <UploadPanel documents={pending} />
        ) : (
          <IssuanceBlocked address={issuer?.address} />
        )}
        <IssuerPanel />
      </div>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">Your notes</h2>
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Principal</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead>Maturity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Contract</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {notes.map((note) => (
                <TableRow key={note.id}>
                  <TableCell>
                    <Link
                      href={
                        note.status === "review"
                          ? `/review/${note.id}`
                          : `/note/${note.id}`
                      }
                      className="font-medium hover:text-verified"
                    >
                      {note.name}
                    </Link>
                    <span className="ml-2 font-mono text-xs text-muted-foreground">
                      {note.symbol}
                    </span>
                  </TableCell>
                  <TableCell className="tnum text-right">
                    {money(note.terms.principal.value)}
                  </TableCell>
                  <TableCell className="tnum text-right">
                    {percent(note.terms.interestRatePct.value)}
                  </TableCell>
                  <TableCell className="tnum">
                    {monthYear(note.terms.maturityDate.value)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={note.status} />
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground">
                    {note.address ? truncateHex(note.address, 6, 4) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </section>
    </div>
  );
}

/**
 * The happy path entry point. Extraction is not wired up yet, so rather than
 * fake a spinner over a real upload we hand the reviewer the sample documents
 * directly and say so.
 */
function UploadPanel({
  documents,
}: {
  documents: ReturnType<typeof useNotes>["notes"];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload document</CardTitle>
        <CardDescription>
          A PDF of the executed agreement. The source file is hashed and the
          hash is written on-chain, binding the token to this exact document.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-dashed border-input px-6 py-10 text-center">
          <Upload className="mx-auto size-6 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">Drag and drop a PDF here</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Extraction service not yet connected — use a sample document below.
          </p>
        </div>

        <div>
          <FieldLabel>Sample documents</FieldLabel>
          <ul className="mt-2 space-y-2">
            {documents.map((note) => (
              <li key={note.id}>
                <Link
                  href={`/review/${note.id}`}
                  className="flex items-center gap-3 rounded border border-border bg-background px-3 py-2.5 transition-colors hover:border-input"
                >
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {note.document.filename}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {note.issuer.name} · {money(note.terms.principal.value)}
                    </span>
                  </span>
                  <StatusBadge status={note.status} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
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
