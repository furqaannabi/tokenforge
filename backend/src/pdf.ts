import { extractText, getMeta } from "unpdf";

/**
 * The text layer of a PDF.
 *
 * This is the step in front of extraction: a model reads text, and a PDF is a
 * description of marks on a page. `unpdf` wraps a serverless build of pdf.js,
 * so there is no native dependency to install and nothing to compile.
 *
 * What it cannot do is read a scan. A photographed or faxed agreement has no
 * text layer at all, and no amount of parsing invents one — that needs OCR.
 * The distinction matters enough to report rather than to paper over with an
 * empty string, because an empty document would otherwise reach the model and
 * come back as an extraction full of confidently absent fields.
 */

export class NoTextLayerError extends Error {
  constructor(readonly pages: number) {
    super(
      `This PDF has ${pages} page${pages === 1 ? "" : "s"} but no text layer, which usually means it is a scan. Extracting terms from it needs OCR, which is not wired up — supply the text directly instead.`,
    );
    this.name = "NoTextLayerError";
  }
}

export interface PdfText {
  text: string;
  pages: number;
  /** Present when the document declares one. */
  title?: string;
}

/** Characters below which a "text layer" is really just page furniture. */
const MINIMUM_USEFUL_CHARACTERS = 40;

export async function extractPdfText(bytes: Uint8Array): Promise<PdfText> {
  // A fresh copy: pdf.js transfers the buffer it is given, which leaves the
  // caller's view detached — and the caller still needs those bytes to hash
  // and store the document.
  const source = new Uint8Array(bytes);

  const { text, totalPages } = await extractText(source, {
    // Joined into one string rather than per page: a clause routinely runs
    // across a page break, and the review pane matches quotes by exact
    // substring, so a break inserted mid-sentence would lose the match.
    mergePages: true,
  });

  const cleaned = normalise(text as string);

  if (cleaned.length < MINIMUM_USEFUL_CHARACTERS) {
    throw new NoTextLayerError(totalPages);
  }

  let title: string | undefined;
  try {
    const meta = await getMeta(new Uint8Array(bytes));
    const declared = (meta.info as { Title?: string } | undefined)?.Title;
    if (declared?.trim()) title = declared.trim();
  } catch {
    // Metadata is a nicety; a document that will not give up its title is
    // still perfectly extractable.
  }

  return { text: cleaned, pages: totalPages, title };
}

/**
 * Tidies pdf.js output without rewriting it.
 *
 * Deliberately conservative. Every extracted value carries the verbatim span it
 * came from, matched later by exact substring, so anything this function
 * changes has to be a change the model will also see. Collapsing runs of
 * spaces and blank lines is safe; rewriting punctuation or hyphenation is not,
 * because it would break quotes that were correct when they were produced.
 */
function normalise(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    // pdf.js emits a space per positioned glyph run, so words routinely arrive
    // separated by several.
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}
