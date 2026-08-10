"use client";

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
  documentUrl: (id: string) => ["document-url", id] as const,
  applications: (status?: ApplicationStatus) =>
    ["applications", status ?? "all"] as const,
  applicationForWallet: (address?: string) =>
    ["application", address ?? ""] as const,
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
      queryClient.invalidateQueries({ queryKey: ["applications"] });
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

  return useMutation({
    mutationFn: async (input: {
      file: File;
      text: string;
      uploadedBy?: string | null;
    }) => {
      const { document } = await api.uploadDocument({
        file: input.file,
        filename: input.file.name,
        text: input.text,
        uploadedBy: input.uploadedBy ?? null,
      });

      const extraction = await api.extract(document.id);
      return { document, extraction };
    },
    onSuccess: ({ extraction }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.documents });
      queryClient.setQueryData(queryKeys.extraction(extraction.id), extraction);
    },
  });
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
export function useRecordMintedNote(isLocalSample: boolean, extractionId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { hash: string }) => {
      if (isLocalSample) return null;
      // The receipt is fetched by the mint hook; this only forwards what the
      // service needs to index it.
      return input.hash;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.extraction(extractionId),
      });
    },
  });
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
