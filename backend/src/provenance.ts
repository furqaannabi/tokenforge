import { z } from "zod";
import type { ExtractedTerms } from "@tokenforge/core";
import { llm, MODEL } from "./llm";

/**
 * Two questions the hash cannot answer.
 *
 * `NoteFactory` refuses a document hash it has already tokenized, and the
 * documents table is unique on the same value, so the identical file cannot be
 * sold twice. Both are exact-byte checks, and neither is what a duplicate
 * usually looks like: the same agreement re-exported, re-typeset, or scanned is
 * a different file describing the same loan, and it walks through both.
 *
 * Nothing checks whose agreement it is either. Registry membership decides who
 * may mint; it says nothing about whether the document a member uploaded is
 * theirs, so a registered issuer could tokenize a competitor's loan.
 *
 * These are review aids, not a security boundary. A model comparing company
 * names is not proof of title, and it is scored and explained rather than
 * enforced silently — the reviewer decides.
 */

export const provenanceSchema = z.object({
  ownership: z.object({
    /** Whether the document's lender is the issuer applying to mint it. */
    belongsToIssuer: z.boolean(),
    confidence: z.number().min(0).max(1),
    /** The lender exactly as the document names it. */
    documentLender: z.string(),
    reason: z.string(),
  }),
  /** Null when no borrower wallet has been named yet. */
  borrower: z
    .object({
      matchesDocument: z.boolean(),
      confidence: z.number().min(0).max(1),
      /** The borrower exactly as the document names it. */
      documentBorrower: z.string(),
      reason: z.string(),
    })
    .nullable(),
  duplicate: z.object({
    isDuplicate: z.boolean(),
    /** The extraction this repeats, or null. */
    ofExtractionId: z.string().nullable(),
    confidence: z.number().min(0).max(1),
    reason: z.string(),
  }),
});

export type Provenance = z.infer<typeof provenanceSchema>;

/** A party as the registry knows them, ready to be held against a document. */
export interface Party {
  address: string;
  name: string;
  jurisdiction: string;
}

export interface Candidate {
  extractionId: string;
  filename: string;
  status: string;
  borrower: string;
  lender: string;
  principal: number;
  agreementDate: string;
  maturityDate: string;
}

const PROMPT = `You are checking a loan agreement before it is tokenized.

Answer three independent questions.

1. OWNERSHIP — is the party applying to tokenize this agreement the lender in
   it? You are given the name the applicant is registered under and the lender
   the document names. Legal entities are written inconsistently: "Meridian
   Freight Holdings LLC", "Meridian Freight Holdings, L.L.C." and "MERIDIAN
   FREIGHT HOLDINGS LIMITED LIABILITY COMPANY" are the same company. A parent
   and its named subsidiary are not the same company, but say so in the reason
   rather than silently choosing. If the document's lender is a different
   company altogether, that is a refusal.

   Judge the names as legal entities, not as strings. Report what the document
   actually calls the lender in documentLender, verbatim.

2. BORROWER — is the wallet named as borrower the same company the document
   says is borrowing? You are given the name that wallet is registered under.
   Judge it exactly as you judge the lender: entities, not strings. A parent
   and a named subsidiary are not the same company; say which you think it is
   rather than guessing quietly. If no borrower wallet has been named yet,
   return null for this whole section rather than inventing a verdict.

   This matters as much as ownership. The borrower is the party that will owe
   the money and sign the acceptance, and naming the wrong wallet creates an
   obligation for a company that never agreed to it.

3. DUPLICATE — does this agreement already appear among the candidates? They
   have different file hashes by construction, so identical bytes are not the
   question. The question is whether two files describe the same underlying
   loan: same parties, same principal, same dates, same schedule. A re-exported
   or rescanned copy of one agreement is a duplicate. Two genuinely separate
   facilities between the same parties are not — companies borrow more than
   once, and amounts and dates will differ.

   If it is a duplicate, name the extraction id it repeats. If nothing matches,
   isDuplicate is false and ofExtractionId is null.

Confidence is your own, per answer. Reserve values above 0.9 for cases where
the evidence is unambiguous. A near-match on a company name, or a candidate
that agrees on principal but not on dates, is not unambiguous.

Keep each reason to one or two sentences, and cite the detail that decided it.`;

/**
 * Runs all three checks in one call.
 *
 * One call rather than three because they share the expensive context — the
 * agreement's parties and figures — and splitting it would send the same
 * material repeatedly for no gain in answer quality.
 */
export async function checkProvenance(input: {
  terms: ExtractedTerms;
  issuer: Party;
  /** Absent until a borrower wallet has been chosen for the mint. */
  borrower?: Party;
  candidates: Candidate[];
}): Promise<Provenance> {
  const { terms, issuer, borrower, candidates } = input;

  const question = [
    `Applicant (issuer) registered name: ${issuer.name}`,
    `Applicant jurisdiction: ${issuer.jurisdiction}`,
    borrower
      ? `Wallet named as borrower is registered as: ${borrower.name} (${borrower.jurisdiction})`
      : "No borrower wallet has been named yet.",
    "",
    "This agreement, as extracted:",
    JSON.stringify(
      {
        lender: terms.lender.value,
        borrower: terms.borrower.value,
        principal: terms.principal.value,
        agreementDate: terms.agreementDate.value,
        maturityDate: terms.maturityDate.value,
        interestRatePct: terms.interestRatePct.value,
      },
      null,
      2,
    ),
    "",
    candidates.length
      ? `Previously extracted agreements:\n${JSON.stringify(candidates, null, 2)}`
      : "Previously extracted agreements: none.",
  ].join("\n");

  const response = await llm().models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: `${PROMPT}\n\n${question}` }] }],
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: z.toJSONSchema(provenanceSchema),
    },
  });

  const text = response.text;
  if (!text) throw new Error("The provenance check returned no content.");

  const parsed = provenanceSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    throw new Error(
      `The provenance check did not match its schema: ${parsed.error.message}`,
    );
  }

  /*
   * A model naming an id that was never offered would send the reviewer to a
   * record that does not exist, so an unrecognised one is dropped rather than
   * trusted. The verdict stands; only the pointer is discarded.
   */
  const result = parsed.data;

  // A verdict about a party nobody has named is noise, whatever the model says.
  if (!borrower) result.borrower = null;
  if (
    result.duplicate.ofExtractionId &&
    !candidates.some((c) => c.extractionId === result.duplicate.ofExtractionId)
  ) {
    result.duplicate.ofExtractionId = null;
  }

  return result;
}
