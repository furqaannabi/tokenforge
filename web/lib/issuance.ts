/**
 * Issuance parameters chosen by the platform rather than read from a document.
 */

/**
 * Tokens minted per note.
 *
 * A round number so a holding reads as a percentage at a glance: 1,000 tokens
 * means one token is 0.1% of the loan. Nothing in the contracts depends on it —
 * they only care about ratios — so it is presentation, not economics.
 */
export const SUPPLY_TOKENS = 1_000;

/**
 * Whether an id belongs to a local sample rather than the extraction service.
 *
 * Samples live in client state and have no server-side record to update after a
 * mint. Service extractions are cuids, which the fixtures deliberately are not.
 */
export function localNoteId(id: string): boolean {
  return ["meridian", "halcyon", "apex"].includes(id);
}
