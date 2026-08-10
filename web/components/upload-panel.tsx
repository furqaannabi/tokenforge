"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, TriangleAlert, Upload } from "lucide-react";
import { Stamp } from "@/components/primitives";
import { FIELD_LABELS, LOW_CONFIDENCE_THRESHOLD, type TermField } from "@tokenforge/core";
import { confidencePct } from "@/lib/format";
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

/**
 * Live progress while the model works.
 *
 * Two passes over a full agreement take about a minute. Showing each term as
 * it lands turns that from an unexplained wait into something legible — and it
 * shows the confidence arriving with the value, which is the point the product
 * is making.
 */
function ExtractionProgress({
  stage,
  fields,
}: {
  stage: string | null;
  fields: Array<{ field: string; confidence: number }>;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border bg-background p-3">
      <p className="flex items-center gap-2 text-sm">
        <Loader2 className="size-3.5 animate-spin text-verified" />
        {stage ?? "Working"}
      </p>

      {fields.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {fields.map(({ field, confidence }) => (
            <li key={field}>
              <Stamp tone={confidence < LOW_CONFIDENCE_THRESHOLD ? "review" : "verified"}>
                {FIELD_LABELS[field as TermField] ?? field} {confidencePct(confidence)}
              </Stamp>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">
          Terms appear here as they are read.
        </p>
      )}
    </div>
  );
}

/**
 * The upload entry point.
 *
 * Sends the real file to the extraction service, which hashes its bytes for
 * provenance. Until a PDF parser exists the service also needs a text layer, so
 * this reads text files directly and asks for a paste when handed a PDF —
 * stating the limitation rather than silently extracting nothing.
 */
export function UploadPanel() {
  const router = useRouter();
  const { address } = useWallet();
  const health = useServiceHealth();
  const upload = useUploadAndExtract();
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);

  const serviceDown = health.isError;

  const [rejected, setRejected] = useState<string | null>(null);

  /**
   * PDFs only.
   *
   * The service reads the text layer out of the file, so there is nothing to
   * do here but hand it over. Refusing other formats up front is kinder than
   * uploading something that will fail on the far side — and the document that
   * gets hashed onto the chain should be the executed agreement, not a
   * transcription of it.
   */
  const handleFile = (picked: File) => {
    const isPdf =
      picked.type === "application/pdf" ||
      picked.name.toLowerCase().endsWith(".pdf");

    if (!isPdf) {
      setRejected(`${picked.name} is not a PDF.`);
      setFile(null);
      return;
    }

    setRejected(null);
    setFile(picked);
  };

  const submit = async () => {
    if (!file) return;
    const result = await upload.mutateAsync({
      file,
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
            if (dropped) handleFile(dropped);
          }}
          className="rounded-lg border border-dashed border-input px-6 py-8 text-center"
        >
          <Upload className="mx-auto size-6 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">
            {file ? file.name : "Drag and drop the signed PDF"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {file
              ? `${(file.size / 1024).toFixed(0)} KB`
              : "PDF — the text layer is read out of it"}
          </p>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(event) => {
              const picked = event.target.files?.[0];
              if (picked) handleFile(picked);
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

        {rejected ? (
          <p className="flex items-start gap-1.5 text-xs text-review">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            {rejected} Upload the executed agreement as a PDF.
          </p>
        ) : null}

        {upload.isError ? (
          <Alert className="border-impaired/40 bg-impaired/10">
            <TriangleAlert className="text-impaired" />
            <AlertTitle className="text-impaired">Extraction failed</AlertTitle>
            <AlertDescription>{(upload.error as Error).message}</AlertDescription>
          </Alert>
        ) : null}

        {upload.isPending ? <ExtractionProgress stage={upload.stage} fields={upload.fields} /> : null}

        <Button
          className="w-full"
          disabled={!file || upload.isPending || serviceDown}
          onClick={() => void submit()}
        >
          {upload.isPending ? (
            <>
              <Loader2 className="animate-spin" /> Extracting…
            </>
          ) : (
            "Upload and extract"
          )}
        </Button>

      </CardContent>
    </Card>
  );
}
