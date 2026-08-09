import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { confidencePct } from "@/lib/format";
import { LOW_CONFIDENCE_THRESHOLD } from "@/lib/validator";
import type { NoteStatus } from "@/lib/types";

/**
 * Domain primitives built on shadcn.
 *
 * The one place we override shadcn's defaults is badge shape: these are
 * rectangles, not pills, because they stand in for stamps on a legal document.
 */

const STAMP =
  "rounded-sm border font-mono text-[11px] font-semibold uppercase tracking-[0.05em]";

export type Tone = "verified" | "review" | "impaired" | "neutral";

const TONE: Record<Tone, string> = {
  verified: "border-verified/30 bg-verified/10 text-verified",
  review: "border-review/40 bg-review/10 text-review",
  impaired: "border-impaired/40 bg-impaired/10 text-impaired",
  neutral: "border-border bg-muted text-muted-foreground",
};

export function Stamp({
  tone = "neutral",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(STAMP, TONE[tone], "h-5 px-1.5", className)}
    >
      {children}
    </Badge>
  );
}

/**
 * A field's extraction confidence. Amber below the review threshold — the same
 * cut the mint gate uses, so the badge and the block always agree.
 */
export function ConfidenceBadge({
  confidence,
  confirmed,
}: {
  confidence: number;
  confirmed?: boolean;
}) {
  if (confirmed) {
    return <Stamp tone="verified">✓ Confirmed</Stamp>;
  }
  const low = confidence < LOW_CONFIDENCE_THRESHOLD;
  return (
    <Stamp tone={low ? "review" : "verified"}>
      {confidencePct(confidence)} conf
    </Stamp>
  );
}

const STATUS_TONE: Record<NoteStatus, Tone> = {
  draft: "neutral",
  review: "review",
  live: "verified",
  impaired: "impaired",
  matured: "neutral",
};

const STATUS_LABEL: Record<NoteStatus, string> = {
  draft: "Draft",
  review: "In Review",
  live: "Live",
  impaired: "Impaired",
  matured: "Matured",
};

export function StatusBadge({ status }: { status: NoteStatus }) {
  return <Stamp tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Stamp>;
}

// ---------------------------------------------------------------------------

/** Uppercase monospaced metadata label. */
export function FieldLabel({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "font-mono text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatTile({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: ReactNode;
  tone?: "verified" | "impaired";
  sub?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <FieldLabel>{label}</FieldLabel>
      <p
        className={cn(
          "tnum mt-2 text-xl font-semibold",
          tone === "verified" && "text-verified",
          tone === "impaired" && "text-impaired",
          !tone && "text-foreground",
        )}
      >
        {value}
      </p>
      {sub ? (
        <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
      ) : null}
    </div>
  );
}

/** An on-chain value shown verbatim: document hash, contract address, tx. */
export function HexValue({ label, value }: { label?: string; value: string }) {
  return (
    <div className="rounded border border-border bg-background px-3 py-2.5">
      {label ? <FieldLabel className="mb-1 block">{label}</FieldLabel> : null}
      <code className="font-mono text-xs break-all text-muted-foreground">
        {value}
      </code>
    </div>
  );
}
