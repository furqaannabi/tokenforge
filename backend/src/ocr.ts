import { MODEL_FAST, llm, pdfPart } from "./llm";

/**
 * Reads a scanned document.
 *
 * A photographed or faxed agreement has no text layer, so pdf.js has nothing to
 * return. Gemini reads the pages as images, which closes that gap without an
 * OCR engine to install or a second service to run.
 *
 * The output is a transcription rather than an extraction, and that is the
 * whole point. Everything downstream works on text: the validator, the review
 * pane, and above all the quote matching that lets a value be traced back to
 * the clause it came from. Producing the missing text layer keeps all of it
 * intact, where reading terms straight off the image would leave every quote
 * pointing at nothing.
 */

const TRANSCRIPTION_PROMPT = `Transcribe this document to plain text, exactly as it reads.

This is a transcription, not a summary and not an interpretation:

- Reproduce the wording character for character, including headings, clause numbers, and figures. Quotations of this text are later matched against your output, so a paraphrase silently breaks that link.
- Keep the reading order of the page. Where the document uses a table, write each row on its own line with columns separated by " - ", since that is the order a reader follows.
- Do not correct apparent errors, expand abbreviations, reformat dates, or normalise amounts. If the page states 6.00% and a table elsewhere implies otherwise, transcribe both as printed and leave the contradiction standing — resolving it is not the job here, and doing so would destroy the evidence that it existed.
- Where a word is genuinely illegible write [illegible] rather than guessing.

Return only the transcribed text.`;

export async function transcribePdf(bytes: Uint8Array): Promise<string> {
  const response = await llm().models.generateContent({
    // Flash rather than pro: this is reading, not reasoning, and a scanned
    // agreement can run to many pages at roughly 258 tokens each.
    model: MODEL_FAST,
    contents: [{ parts: [{ text: TRANSCRIPTION_PROMPT }, pdfPart(bytes)] }],
  });

  const text = response.text?.trim();
  if (!text) throw new Error("Transcription of the scan returned nothing.");
  return text;
}
