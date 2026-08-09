"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { api, type ApiDocument, type ApiExtraction } from "./api";

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
};

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
