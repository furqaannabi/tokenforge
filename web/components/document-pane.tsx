"use client";

import { FileText } from "lucide-react";
import { highlightsFor, segmentBlock } from "@/lib/highlight";
import { truncateHex } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ExtractedTerms, SourceDocument, TermField } from "@/lib/types";

/**
 * The source pane of the review screen.
 *
 * Renders the document with every extracted span highlighted and toned by
 * confidence, so the reviewer's eye can travel between a term card and the
 * clause it came from without leaving the screen.
 */
export function DocumentPane({
  document,
  terms,
  activeField,
  onFieldHover,
}: {
  document: SourceDocument;
  terms: ExtractedTerms;
  activeField: TermField | null;
  onFieldHover: (field: TermField | null) => void;
}) {
  const highlights = highlightsFor(terms);

  return (
    <div className="flex min-h-0 flex-col border-r border-border">
      <div className="flex items-center gap-2 border-b border-border bg-card px-5 py-3">
        <FileText className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium">
          {document.filename}
        </span>
        <code className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">
          {truncateHex(document.hash, 8, 6)}
        </code>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
        <article className="mx-auto max-w-[62ch] space-y-4 leading-relaxed">
          {document.body.map((block, index) => {
            const segments = segmentBlock(block.text, highlights);

            const content = segments.map((segment, segmentIndex) =>
              segment.field ? (
                <mark
                  key={segmentIndex}
                  onMouseEnter={() => onFieldHover(segment.field!)}
                  onMouseLeave={() => onFieldHover(null)}
                  className={cn(
                    "rounded-sm px-0.5 transition-colors",
                    segment.tone === "review"
                      ? "bg-review/15 text-review"
                      : "bg-verified/15 text-verified",
                    activeField === segment.field &&
                      (segment.tone === "review"
                        ? "bg-review/35 ring-1 ring-review"
                        : "bg-verified/35 ring-1 ring-verified"),
                  )}
                >
                  {segment.text}
                </mark>
              ) : (
                <span key={segmentIndex}>{segment.text}</span>
              ),
            );

            if (block.kind === "title") {
              return (
                <h2
                  key={index}
                  className="pb-2 text-center text-lg font-bold tracking-wide"
                >
                  {content}
                </h2>
              );
            }
            if (block.kind === "heading") {
              return (
                <h3 key={index} className="pt-3 text-sm font-bold">
                  {content}
                </h3>
              );
            }
            return (
              <p key={index} className="text-sm text-foreground/90">
                {content}
              </p>
            );
          })}
        </article>
      </div>
    </div>
  );
}
