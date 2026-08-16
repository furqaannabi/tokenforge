import { MODEL_FAST, llm, pdfBlock } from "./llm";

/**
 * Reads a scanned document.
 *
 * A photographed or faxed agreement has no text layer, so pdf.js has nothing to
 * return. The model reads the pages as images, which closes that gap without an
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
  const response = await llm().messages.create({
    // The fast slot: this is reading, not reasoning, and a scanned agreement
    // can run to many pages. Effort is pinned low for the same reason — the
    // work is transcription, and deliberation buys nothing but tokens.
    model: MODEL_FAST,
    max_tokens: 16000,
    output_config: { effort: "low" },
    messages: [
      {
        role: "user",
        content: [
          // Document first, then the instruction: the documented ordering,
          // and it reads better than a question with an attachment trailing.
          pdfBlock(bytes),
          { type: "text", text: TRANSCRIPTION_PROMPT },
        ],
      },
    ],
  });

  /*
   * A refusal is not an empty transcription.
   *
   * Safety classifiers answer with a 200 and no content, so code that reaches
   * straight for the text would report "returned nothing" and send someone
   * looking at the PDF parser. Say which happened.
   */
  if (response.stop_reason === "refusal") {
    throw new Error(
      "The model declined to transcribe this document, so it cannot be read here.",
    );
  }

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  if (!text) throw new Error("Transcription of the scan returned nothing.");

  // A transcription cut off mid-document is worse than none: the text looks
  // complete, and every quote past the cut silently fails to match.
  if (response.stop_reason === "max_tokens") {
    throw new Error(
      "The scan is longer than one transcription pass. Raise max_tokens or split the document.",
    );
  }

  return text;
}
