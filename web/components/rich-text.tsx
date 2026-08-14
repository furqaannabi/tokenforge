import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Zoya's replies, rendered.
 *
 * `react-markdown` rather than the hand-rolled parser this replaces: she
 * reaches for headings, nested lists, tables and strikethrough without being
 * asked, and each one was a bug waiting to show its markup to a user. Two
 * rounds of "she emits something the parser does not know" was enough.
 *
 * It keeps the property that mattered about the hand-rolled version — the
 * output is a React tree, not injected HTML. Raw HTML in the source is
 * discarded unless `rehype-raw` is added, and it is deliberately not added:
 * this text comes from a model that has just been reading an uploaded loan
 * agreement, so a sentence inside a PDF must never be able to put markup on
 * the page.
 *
 * Styling comes through `components` rather than a typography plugin, because
 * a chat bubble is not a document — a model reaching for `h1` should not get
 * 32px type inside a 24rem panel.
 */

export function RichText({ text }: { text: string }) {
  return (
    <div className="space-y-2">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          /*
           * Every heading level renders the same: small, weighted, muted.
           * Which level she picked says nothing about importance here, and six
           * distinct sizes inside a chat bubble would only look broken.
           */
          h1: Heading,
          h2: Heading,
          h3: Heading,
          h4: Heading,
          h5: Heading,
          h6: Heading,

          ul: ({ children }) => (
            <ul className="ml-4 list-outside list-disc space-y-1">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="ml-4 list-outside list-decimal space-y-1">
              {children}
            </ol>
          ),

          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">
              {children}
            </strong>
          ),

          code: ({ children }) => (
            <code className="rounded bg-muted px-1 py-px font-mono text-[0.85em]">
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded border border-border bg-muted p-2 text-[0.85em]">
              {children}
            </pre>
          ),

          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-border pl-3 text-muted-foreground">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="border-border" />,

          /*
           * Tables scroll inside their own box. She can return a repayment
           * schedule, which is wider than the panel at any font size worth
           * reading, and a table that widens the bubble would break the layout
           * rather than its own container.
           */
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-border py-1 pr-3 font-medium">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-border py-1 pr-3 align-top">
              {children}
            </td>
          ),

          /*
           * She is told not to send people off-site, but a model can still
           * produce a link. A new tab and `noreferrer` mean a stray one cannot
           * navigate the app away from itself or leak where it came from.
           */
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="text-verified underline underline-offset-2"
            >
              {children}
            </a>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}

function Heading({ children }: { children?: React.ReactNode }) {
  return (
    <p className="pt-1 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
      {children}
    </p>
  );
}
