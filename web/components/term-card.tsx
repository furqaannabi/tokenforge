"use client";

import { TriangleAlert } from "lucide-react";
import { ConfidenceBadge, FieldLabel } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FIELD_LABELS } from "@tokenforge/core";
import { cn } from "@/lib/utils";
import type { TermField } from "@/lib/types";

export type EditorKind = "text" | "number" | "percent" | "date" | "select";

/**
 * One extracted term, beside its confidence.
 *
 * Any field can be corrected — a reviewer who spots an error in a 99% field
 * should be able to fix it. What low confidence changes is that the field must
 * be *actively* confirmed before the mint gate opens; high-confidence fields
 * are cleared by default.
 */
export function TermCard({
  field,
  value,
  kind,
  options,
  confidence,
  confirmed,
  note,
  active,
  onHover,
  onChange,
  onConfirm,
}: {
  field: TermField;
  value: string;
  kind: EditorKind;
  options?: readonly string[];
  confidence: number;
  confirmed: boolean;
  /** Null when the model had nothing to flag; absent on hand-built terms. */
  note?: string | null;
  active: boolean;
  onHover: (field: TermField | null) => void;
  onChange: (next: string) => void;
  onConfirm: () => void;
}) {
  const needsReview = !confirmed;

  return (
    <div
      onMouseEnter={() => onHover(field)}
      onMouseLeave={() => onHover(null)}
      className={cn(
        "rounded-lg border bg-card p-3 transition-colors",
        needsReview ? "border-review" : "border-border",
        active && "ring-1 ring-verified",
        active && needsReview && "ring-review",
      )}
    >
      {needsReview ? (
        <div className="mb-2 flex items-center gap-1.5 text-review">
          <TriangleAlert className="size-3" />
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.05em]">
            Human verification required
          </span>
        </div>
      ) : null}

      <div className="mb-2 flex items-center justify-between gap-3">
        <FieldLabel>{FIELD_LABELS[field] ?? field}</FieldLabel>
        <ConfidenceBadge confidence={confidence} confirmed={confirmed} />
      </div>

      {kind === "select" ? (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger className="w-full font-mono">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options?.map((option) => (
              <SelectItem key={option} value={option} className="font-mono">
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <div className="relative">
          <Input
            type={kind === "number" || kind === "percent" ? "number" : kind === "date" ? "date" : "text"}
            step={kind === "percent" ? "0.01" : undefined}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className={cn("tnum font-mono", kind === "percent" && "pr-8")}
          />
          {kind === "percent" ? (
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center font-mono text-sm text-muted-foreground">
              %
            </span>
          ) : null}
        </div>
      )}

      {note && needsReview ? (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {note}
        </p>
      ) : null}

      {needsReview ? (
        <Button
          variant="outline"
          size="sm"
          onClick={onConfirm}
          className="mt-2 w-full border-review/40 text-review hover:bg-review/10 hover:text-review"
        >
          Confirm as extracted
        </Button>
      ) : null}
    </div>
  );
}
