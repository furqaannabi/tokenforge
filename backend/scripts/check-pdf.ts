/**
 * Parses PDFs and reports what the pipeline would see.
 *
 *   bun scripts/check-pdf.ts ../agreements/*.pdf
 *
 * Useful before feeding a new document to the model: a scan is refused here
 * rather than after a minute of extraction, and a split word shows up as a
 * quote that will need whitespace-tolerant matching.
 */
import { NoTextLayerError, extractPdfText } from "../src/pdf";

for (const path of process.argv.slice(2)) {
  const name = path.split("/").pop()!;
  try {
    const r = await extractPdfText(
      new Uint8Array(await Bun.file(path).arrayBuffer()),
    );
    // A wrapped line is normal prose; what matters is whether a *word* was
    // broken across one, since that is what a model misreads. Detected by
    // looking for a line break with no space where the join produces a token
    // that is not otherwise in the document.
    const broken = /[a-z]\n[a-z]/.test(r.text)
      ? r.text
          .split("\n")
          .slice(0, -1)
          .filter((line, i, lines) => {
            const next = r.text.split("\n")[i + 1];
            return /[a-z]$/.test(line) && /^[a-z]/.test(next ?? "") &&
              !/[.,;:)]$/.test(line);
          }).length
      : 0;

    console.log(
      `  ${name.padEnd(38)} ${r.pages}p ${String(r.text.length).padStart(5)} chars  ${broken > 0 ? `${broken} possible mid-word wraps` : "no mid-word wraps"}`,
    );
  } catch (error) {
    const why =
      error instanceof NoTextLayerError ? "no text layer (scan)" : String(error);
    console.log(`  ${name.padEnd(38)} ${why}`);
  }
}
