import { Fragment } from "react";

/**
 * The small slice of Markdown an assistant actually emits.
 *
 * Headings, bold, italics, inline code, bullets, numbered lists and
 * paragraphs. Nothing else, and — the part that matters — nothing is handed to
 * `dangerouslySetInnerHTML`. This text comes from a model that has just been
 * reading uploaded documents, so treating it as markup would let a sentence
 * inside a loan agreement put HTML on the page. Everything here becomes React
 * elements, so the worst a stray angle bracket can do is look like an angle
 * bracket.
 *
 * A parser rather than a library because the whole grammar is a handful of
 * rules; a Markdown dependency would bring tables, links, images and raw HTML
 * passthrough, all of which are attack surface here and none of which she
 * needs.
 */

/** `**bold**`, `*italic*` and `` `code` `` within a single line. */
function inline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const pattern = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g;
  let cursor = 0;
  let key = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) parts.push(text.slice(cursor, match.index));

    const token = match[0];
    parts.push(
      token.startsWith("**") ? (
        <strong key={key++} className="font-semibold text-foreground">
          {token.slice(2, -2)}
        </strong>
      ) : token.startsWith("*") ? (
        <em key={key++}>{token.slice(1, -1)}</em>
      ) : (
        <code
          key={key++}
          className="rounded bg-muted px-1 py-px font-mono text-[0.85em]"
        >
          {token.slice(1, -1)}
        </code>
      ),
    );
    cursor = match.index + token.length;
  }

  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*•]\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;

export function RichText({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  let items: string[] = [];
  let ordered = false;
  let paragraph: string[] = [];
  let key = 0;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(
      <p key={key++} className="whitespace-pre-wrap">
        {paragraph.map((line, index) => (
          <Fragment key={index}>
            {index > 0 ? <br /> : null}
            {inline(line)}
          </Fragment>
        ))}
      </p>,
    );
    paragraph = [];
  };

  const flushList = () => {
    if (items.length === 0) return;
    const List = ordered ? "ol" : "ul";
    blocks.push(
      <List
        key={key++}
        className={
          ordered
            ? "ml-4 list-outside list-decimal space-y-1"
            : "ml-4 list-outside list-disc space-y-1"
        }
      >
        {items.map((item, index) => (
          <li key={index}>{inline(item)}</li>
        ))}
      </List>,
    );
    items = [];
  };

  for (const line of text.split("\n")) {
    /*
     * Headings arrive as "### Holdings". They are rendered at body size and
     * merely weighted: a chat bubble is not a document, and a model reaching
     * for h3 should not get 24px type inside a 24rem panel.
     */
    const heading = HEADING.exec(line);
    if (heading) {
      flushList();
      flushParagraph();
      blocks.push(
        <p
          key={key++}
          className="pt-1 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground"
        >
          {inline(heading[2])}
        </p>,
      );
      continue;
    }

    const bullet = BULLET.test(line);
    const numbered = !bullet && NUMBERED.test(line);

    if (bullet || numbered) {
      flushParagraph();
      // A switch of list type starts a new list rather than mixing markers.
      if (items.length > 0 && ordered !== numbered) flushList();
      ordered = numbered;
      items.push(line.replace(bullet ? BULLET : NUMBERED, ""));
      continue;
    }

    if (line.trim() === "") {
      flushList();
      flushParagraph();
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushList();
  flushParagraph();

  return <div className="space-y-2">{blocks}</div>;
}
