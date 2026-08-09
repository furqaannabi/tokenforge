"use client";

/**
 * In-memory note store.
 *
 * Stands in for the contracts and the extraction service. It exists so the mint
 * flow is genuinely stateful during a demo — confirming a low-confidence field
 * really does unlock the mint button, and minting really does move the note to
 * `live` so its token page renders. Resets on reload, which is fine.
 */

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { SEED_NOTES } from "./mock-data";
import type { ExtractedTerms, Note, TermField } from "./types";

interface NotesState {
  notes: Note[];
  getNote: (id: string) => Note | undefined;
  /**
   * Record a human's confirmation or correction of one extracted field.
   *
   * `value` is untyped because the review screen dispatches over a dynamic
   * field key and each field carries a different value type. Parsing happens at
   * the editor, which knows which field it is rendering.
   */
  confirmField: (noteId: string, field: TermField, value?: unknown) => void;
  /** Move a reviewed note on-chain. Callers must check the mint gate first. */
  mint: (noteId: string) => void;
  /** Settle one coupon period, as the issuer depositing USDG would. */
  settlePeriod: (noteId: string, periodIndex: number) => void;
}

const NotesContext = createContext<NotesState | null>(null);

/** Deterministic stand-in for the address NoteFactory would return. */
function deployedAddress(noteId: string): `0x${string}` {
  let hash = 0x811c9dc5;
  for (const char of noteId) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
  }
  const seed = hash.toString(16).padStart(8, "0");
  return `0x${seed.repeat(5)}`;
}

export function NotesProvider({ children }: { children: React.ReactNode }) {
  const [notes, setNotes] = useState<Note[]>(SEED_NOTES);

  const updateNote = useCallback(
    (noteId: string, update: (note: Note) => Note) => {
      setNotes((current) =>
        current.map((note) => (note.id === noteId ? update(note) : note)),
      );
    },
    [],
  );

  const confirmField = useCallback<NotesState["confirmField"]>(
    (noteId, field, value) => {
      updateNote(noteId, (note) => ({
        ...note,
        terms: {
          ...note.terms,
          [field]: {
            ...note.terms[field],
            ...(value !== undefined ? { value } : {}),
            editedByHuman: true,
          },
        },
      }));
    },
    [updateNote],
  );

  const mint = useCallback<NotesState["mint"]>(
    (noteId) => {
      updateNote(noteId, (note) => ({
        ...note,
        status: "live",
        address: note.address ?? deployedAddress(noteId),
      }));
    },
    [updateNote],
  );

  const settlePeriod = useCallback<NotesState["settlePeriod"]>(
    (noteId, periodIndex) => {
      updateNote(noteId, (note) =>
        note.paidPeriods.includes(periodIndex)
          ? note
          : { ...note, paidPeriods: [...note.paidPeriods, periodIndex] },
      );
    },
    [updateNote],
  );

  const value = useMemo<NotesState>(
    () => ({
      notes,
      getNote: (id) => notes.find((note) => note.id === id),
      confirmField,
      mint,
      settlePeriod,
    }),
    [notes, confirmField, mint, settlePeriod],
  );

  return <NotesContext.Provider value={value}>{children}</NotesContext.Provider>;
}

export function useNotes(): NotesState {
  const context = useContext(NotesContext);
  if (!context) {
    throw new Error("useNotes must be used inside a NotesProvider");
  }
  return context;
}
