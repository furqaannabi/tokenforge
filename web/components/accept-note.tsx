"use client";

import { useState } from "react";
import { CircleAlert, Loader2, PenLine } from "lucide-react";
import { Stamp } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAcceptNote, useNoteState } from "@/lib/repayment";
import { useWallet } from "@/lib/wallet";
import { truncateHex } from "@/lib/format";

/**
 * The borrower's signature, and the wait for it.
 *
 * A minted note is the issuer's assertion about somebody else: these terms,
 * this document, that company owes it. Until the named borrower signs, that is
 * all it is — so the note is Pending, and nothing can be transferred, offered
 * or repaid against it.
 *
 * Shown to everyone, not just the borrower. A buyer looking at an unaccepted
 * note needs to know why it cannot be bought, and the issuer needs to see what
 * they are waiting on.
 */
export function AcceptNote({
  note,
  onAccepted,
}: {
  note: `0x${string}`;
  onAccepted?: () => void;
}) {
  const { address } = useWallet();
  const { state, refetch } = useNoteState(note);
  const accept = useAcceptNote(note);
  const [error, setError] = useState<string | null>(null);

  // 3 is Pending. Anything else has already been affirmed, or predates the role.
  if (!state || state.status !== 3) return null;

  const isBorrower =
    Boolean(address) && state.borrower.toLowerCase() === address!.toLowerCase();
  const busy = accept.isSigning || accept.isConfirming;

  const onAccept = async () => {
    setError(null);
    try {
      await accept.accept();
      void refetch();
      onAccepted?.();
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  return (
    <Card className="mt-6 border-review/40">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Awaiting the borrower</CardTitle>
            <CardDescription>
              {isBorrower
                ? "You are named as the borrower on this note. Accepting confirms you owe these terms."
                : "This note is not live until the borrower accepts. Until then it cannot be bought, transferred, or repaid."}
            </CardDescription>
          </div>
          <Stamp tone="review">Pending</Stamp>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Borrower{" "}
          <code className="font-mono">{truncateHex(state.borrower, 8, 6)}</code>
          {isBorrower ? " — this wallet." : ""}
        </p>

        {error ? (
          <p className="flex items-start gap-1.5 text-xs text-impaired">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
            {error}
          </p>
        ) : null}

        {isBorrower ? (
          <Button onClick={onAccept} disabled={busy}>
            {busy ? (
              <>
                <Loader2 className="animate-spin" />
                {accept.isSigning ? "Confirm in wallet…" : "Waiting for the chain…"}
              </>
            ) : (
              <>
                <PenLine /> Accept the terms
              </>
            )}
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">
            Only that wallet can accept. Nobody — not the issuer, not this
            interface — can do it on their behalf.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
