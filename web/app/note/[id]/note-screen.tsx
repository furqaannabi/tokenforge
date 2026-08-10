"use client";

import Link from "next/link";
import { ArrowLeft, BadgeCheck, ExternalLink, FileText, Loader2 } from "lucide-react";
import { FieldLabel, HexValue, Stamp } from "@/components/primitives";
import { OnChainNote } from "@/components/onchain-note";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDocumentUrl, useExtraction } from "@/lib/queries";
import { extractionToNote } from "@/lib/adapt";
import { useWallet } from "@/lib/wallet";
import { percent, monthYear, money } from "@/lib/format";

/**
 * A minted note.
 *
 * Everything that changes lives on the chain and is read from there — balances
 * amortize as principal comes back, so anything cached would be wrong within a
 * period. What the service contributes is provenance: which document this note
 * was minted from, and the hash binding the two.
 */
export function NoteScreen({ noteId }: { noteId: string }) {
  const { address } = useWallet();
  const extraction = useExtraction(noteId);
  const pdf = useDocumentUrl(extraction.data?.document?.id);

  if (extraction.isPending) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </p>
      </div>
    );
  }

  if (extraction.isError || !extraction.data) {
    return (
      <Unavailable
        message={
          (extraction.error as Error)?.message ?? "This note could not be found."
        }
      />
    );
  }

  const record = extraction.data;
  const note = extractionToNote(record, address);
  const minted = record.note;

  if (!minted) {
    return (
      <div className="mx-auto max-w-[600px] px-4 py-16 text-center sm:px-6">
        <h1 className="text-xl font-semibold">This note has not been minted</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Nothing exists on-chain until the extracted terms pass validation and
          an authorized representative approves them.
        </p>
        <Button asChild className="mt-6">
          <Link href={`/review/${noteId}`}>Go to review</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6 sm:py-8">
      <Link
        href="/"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> All documents
      </Link>

      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {minted.name}
          </h1>
          <Stamp tone="neutral">{minted.symbol}</Stamp>
        </div>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          Issued by {note.terms.borrower.value}
          <BadgeCheck className="size-4 text-verified" />
          · {percent(note.terms.interestRatePct.value)} ·{" "}
          {monthYear(note.terms.maturityDate.value)} ·{" "}
          {money(note.terms.principal.value)}
        </p>
      </header>

      <OnChainNote
        note={minted.noteAddress}
        vault={minted.vaultAddress}
        currency={note.currency}
      />

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Provenance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <HexValue
            label="Source document hash"
            value={record.document?.contentHash ?? "—"}
          />
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <FileText className="size-3.5 shrink-0" />
            {record.document?.filename ?? "Unknown document"}
            {pdf.data ? (
              <a
                href={pdf.data}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:text-foreground"
              >
                <ExternalLink className="size-3.5" />
                View PDF
              </a>
            ) : null}
          </p>
          <div className="flex items-baseline justify-between gap-4 border-t border-border pt-3">
            <FieldLabel>Extracted by</FieldLabel>
            <span className="font-mono text-xs text-muted-foreground">
              {record.model}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            The hash binds this token to the exact file it was minted from. Any
            edit to the document produces a different hash.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Unavailable({ message }: { message: string }) {
  return (
    <div className="mx-auto max-w-[600px] px-4 py-16 text-center sm:px-6">
      <h1 className="text-xl font-semibold">Note unavailable</h1>
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
