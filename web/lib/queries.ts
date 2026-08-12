"use client";

import { useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  api,
  type ApiDocument,
  type ApiExtraction,
  type ApiIssuerApplication,
  type ApplicationStatus,
  type ExtractionStatus,
} from "./api";

/**
 * React Query bindings for the extraction service.
 *
 * The query client already exists for wagmi, so this reuses it rather than
 * standing up a second cache.
 */

export const queryKeys = {
  health: ["health"] as const,
  documents: ["documents"] as const,
  extraction: (id: string) => ["extraction", id] as const,
  extractions: (status?: ExtractionStatus) =>
    ["extractions", status ?? "all"] as const,
  documentUrl: (id: string) => ["document-url", id] as const,
  applications: (status?: ApplicationStatus) =>
    ["applications", status ?? "all"] as const,
  /**
   * Lower-cased, because the two ends of this key disagreed about case.
   *
   * Reads pass wagmi's checksummed address; the service stores and returns a
   * lower-cased one, so writing the mutation result to the cache landed under a
   * different key than the panel was reading. The application was saved, and
   * the applicant was shown the empty form again — and could submit it again.
   */
  applicationForWallet: (address?: string) =>
    ["application", address?.toLowerCase() ?? ""] as const,
};

// --- Issuer onboarding -----------------------------------------------------

export function useApplications(status?: ApplicationStatus) {
  return useQuery({
    queryKey: queryKeys.applications(status),
    queryFn: () => api.listApplications(status),
    retry: false,
  });
}

/** The connected wallet's own application, if it has one. */
export function useMyApplication(address?: string) {
  return useQuery<ApiIssuerApplication | null>({
    queryKey: queryKeys.applicationForWallet(address),
    queryFn: () =>
      api.applicationForWallet(address!).catch((error) => {
        // Never having applied is a normal state, not a failure.
        if (error?.status === 404) return null;
        throw error;
      }),
    enabled: Boolean(address),
    retry: false,
  });
}

export function useApply() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.apply,
    onSuccess: (application) => {
      queryClient.setQueryData(
        queryKeys.applicationForWallet(application.walletAddress),
        application,
      );
      // The admin queue, and any other view of this wallet's application.
      queryClient.invalidateQueries({ queryKey: ["applications"] });
      queryClient.invalidateQueries({
        queryKey: queryKeys.applicationForWallet(application.walletAddress),
      });
    },
  });
}

/**
 * Records an admission after the chain has confirmed it.
 *
 * Deliberately not the thing that admits anyone — that already happened, signed
 * by the admin's wallet. This only marks the queue.
 */
export function useRecordAdmission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      txHash: string;
      decidedBy?: string | null;
    }) => api.recordAdmission(input.id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["applications"] });
    },
  });
}

export function useRejectApplication() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      decidedBy?: string | null;
      decisionNote?: string | null;
    }) => api.rejectApplication(input.id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["applications"] });
    },
  });
}

/**
 * Whether the service is reachable.
 *
 * Polled rather than checked once so the UI recovers on its own when the
 * service is started after the page — the common order in development.
 */
export function useServiceHealth() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: api.health,
    retry: false,
    refetchInterval: (query) => (query.state.error ? 5_000 : 30_000),
    staleTime: 10_000,
  });
}

export function useDocuments(): UseQueryResult<ApiDocument[]> {
  return useQuery({
    queryKey: queryKeys.documents,
    queryFn: api.listDocuments,
    retry: false,
  });
}

/** Everything uploaded, with where it has got to. */
export function useExtractions(status?: ExtractionStatus) {
  return useQuery({
    queryKey: queryKeys.extractions(status),
    queryFn: () => api.listExtractions(status),
    retry: false,
  });
}

export function useExtraction(
  id: string | undefined,
): UseQueryResult<ApiExtraction> {
  return useQuery({
    queryKey: queryKeys.extraction(id ?? ""),
    queryFn: () => api.getExtraction(id!),
    enabled: Boolean(id),
    retry: false,
  });
}

/** Short-lived signed URL for the stored PDF. */
export function useDocumentUrl(documentId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.documentUrl(documentId ?? ""),
    queryFn: () => api.documentUrl(documentId!),
    enabled: Boolean(documentId),
    retry: false,
    // Signed URLs expire in five minutes; refresh before they do.
    staleTime: 4 * 60_000,
    refetchInterval: 4 * 60_000,
  });
}

/**
 * Upload then extract, as one action.
 *
 * They are separate endpoints because registering a document and spending money
 * on a model call are different decisions, but from the reviewer's side it is a
 * single step: hand over a PDF, get terms back.
 */
export function useUploadAndExtract() {
  const queryClient = useQueryClient();

  /*
   * Progress lives in component state rather than the mutation, because it
   * changes many times during a single call and React Query has nowhere
   * sensible to put intermediate results.
   */
  const [stage, setStage] = useState<string | null>(null);
  const [fields, setFields] = useState<
    Array<{ field: string; confidence: number }>
  >([]);

  const mutation = useMutation({
    mutationFn: async (input: {
      file: File;
      /** Only for formats the service cannot parse. */
      text?: string;
      uploadedBy?: string | null;
    }) => {
      setStage("Uploading the document");
      setFields([]);

      const { document } = await api.uploadDocument({
        file: input.file,
        filename: input.file.name,
        text: input.text,
        uploadedBy: input.uploadedBy ?? null,
      });

      const extraction = await api.extractStreaming(document.id, (event) => {
        if (event.type === "stage") setStage(event.message);
        if (event.type === "field") {
          setFields((current) => {
            // The audit pass reports the same fields again, with revised
            // confidence. Replace rather than append.
            const rest = current.filter((f) => f.field !== event.field);
            return [...rest, { field: event.field, confidence: event.confidence }];
          });
        }
      });

      setStage(null);
      return { document, extraction };
    },
    onSuccess: ({ extraction }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.documents });
      queryClient.invalidateQueries({ queryKey: ["extractions"] });
      queryClient.setQueryData(queryKeys.extraction(extraction.id), extraction);
    },
    onError: () => setStage(null),
  });

  return Object.assign(mutation, { stage, fields });
}

/** Records a reviewer's corrections and confirmations. */
export function useReviewExtraction(extractionId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      terms?: Record<string, unknown>;
      confirmed?: string[];
      reviewedBy?: string | null;
    }) => api.review(extractionId!, input),
    onSuccess: (extraction) => {
      // The server re-validates, so its answer replaces ours rather than
      // merging with it.
      queryClient.setQueryData(queryKeys.extraction(extraction.id), extraction);
      // A review can move the status to VALIDATED, which the dashboard's
      // queue is sorted by.
      queryClient.invalidateQueries({ queryKey: ["extractions"] });
    },
  });
}

/**
 * Records a mint the chain has already confirmed.
 *
 * Reads the note and vault addresses out of the receipt rather than being told
 * them: the factory creates both, so nothing off-chain knows them until the
 * transaction lands.
 */
export function useRecordMintedNote(extractionId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      hash: string;
      note: string;
      vault: string;
      issuer: string;
      blockNumber: bigint;
      chainId: number;
      name: string;
      symbol: string;
    }) => {
      return api.recordMint(extractionId, {
        chainId: input.chainId,
        noteAddress: input.note,
        vaultAddress: input.vault,
        issuerAddress: input.issuer,
        txHash: input.hash,
        blockNumber: input.blockNumber.toString(),
        name: input.name,
        symbol: input.symbol,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.extraction(extractionId),
      });
    },
  });
}

/**
 * The note and vault addresses for a minted note, if there are any.
 *
 * Sourced from the service's record of the mint rather than guessed: the
 * factory creates both contracts, so their addresses are only knowable from
 * the transaction that created them.
 */
export function useNoteAddresses(extractionId: string) {
  const extraction = useExtraction(extractionId);
  const note = extraction.data?.note;

  if (!note) return undefined;
  return { note: note.noteAddress, vault: note.vaultAddress };
}

export function useRecordMint(extractionId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: Parameters<typeof api.recordMint>[1]) =>
      api.recordMint(extractionId!, input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.extraction(extractionId ?? ""),
      });
    },
  });
}
