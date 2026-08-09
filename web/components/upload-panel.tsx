"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FileText, Loader2, TriangleAlert, Upload } from "lucide-react";
import { FieldLabel, StatusBadge } from "@/components/primitives";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ApiError } from "@/lib/api";
import { useServiceHealth, useUploadAndExtract } from "@/lib/queries";
import { useWallet } from "@/lib/wallet";
import { money } from "@/lib/format";
import type { Note } from "@/lib/types";

/**
 * The upload entry point.
 *
 * Sends the real file to the extraction service, which hashes its bytes for
 * provenance. Until a PDF parser exists the service also needs a text layer, so
 * this reads text files directly and asks for a paste when handed a PDF —
 * stating the limitation rather than silently extracting nothing.
 */
export function UploadPanel({ samples }: { samples: Note[] }) {
  const router = useRouter();
  const { address } = useWallet();
  const health = useServiceHealth();
  const upload = useUploadAndExtract();
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");

  const serviceDown = health.isError;
  const isPdf = file?.type === "application/pdf";

  const handleFile = async (picked: File) => {
    setFile(picked);
    // A PDF's bytes are not its text; anything else we can read as-is.
    if (picked.type !== "application/pdf") {
      setText(await picked.text());
    }
  };

  const submit = async () => {
    if (!file || !text.trim()) return;
    const result = await upload.mutateAsync({
      file,
      text,
      uploadedBy: address ?? null,
    });
    router.push(`/review/${result.extraction.id}`);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload document</CardTitle>
        <CardDescription>
          The file is hashed and its hash written on-chain, binding the token to
          this exact document.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {serviceDown ? (
          <Alert className="border-review/40 bg-review/10">
            <TriangleAlert className="text-review" />
            <AlertTitle className="text-review">
              Extraction service unreachable
            </AlertTitle>
            <AlertDescription>
              {(health.error as ApiError)?.message ??
                "The service is not responding."}{" "}
              Start it with <code className="font-mono text-xs">bun run dev</code>{" "}
              in <code className="font-mono text-xs">backend/</code>. The sample
              documents below still work without it.
            </AlertDescription>
          </Alert>
        ) : null}

        <div
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const dropped = event.dataTransfer.files[0];
            if (dropped) void handleFile(dropped);
          }}
          className="rounded-lg border border-dashed border-input px-6 py-8 text-center"
        >
          <Upload className="mx-auto size-6 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">
            {file ? file.name : "Drag and drop a document"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {file
              ? `${(file.size / 1024).toFixed(0)} KB`
              : "PDF, or a .txt / .md file"}
          </p>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.txt,.md,text/plain,application/pdf"
            className="hidden"
            onChange={(event) => {
              const picked = event.target.files?.[0];
              if (picked) void handleFile(picked);
            }}
          />
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => inputRef.current?.click()}
          >
            Choose file
          </Button>
        </div>

        {isPdf ? (
          <div className="space-y-2">
            <FieldLabel>Text layer</FieldLabel>
            <p className="text-xs text-muted-foreground">
              PDF parsing is not wired up yet, so the text has to be pasted. The
              PDF itself is still stored and hashed — only the extraction input
              comes from here.
            </p>
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={6}
              placeholder="Paste the agreement text…"
              className="w-full rounded border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
        ) : null}

        {upload.isError ? (
          <Alert className="border-impaired/40 bg-impaired/10">
            <TriangleAlert className="text-impaired" />
            <AlertTitle className="text-impaired">Extraction failed</AlertTitle>
            <AlertDescription>{(upload.error as Error).message}</AlertDescription>
          </Alert>
        ) : null}

        <Button
          className="w-full"
          disabled={!file || !text.trim() || upload.isPending || serviceDown}
          onClick={() => void submit()}
        >
          {upload.isPending ? (
            <>
              <Loader2 className="animate-spin" /> Extracting terms…
            </>
          ) : (
            "Upload and extract"
          )}
        </Button>

        <div>
          <FieldLabel>Sample documents</FieldLabel>
          <ul className="mt-2 space-y-2">
            {samples.map((note) => (
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
