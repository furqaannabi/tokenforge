"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Loader2, MessageCircle, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWallet } from "@/lib/wallet";
import { BASE_URL } from "@/lib/api";
import { RichText } from "@/components/rich-text";
import { cn } from "@/lib/utils";

/**
 * Zoya.
 *
 * She reads; she cannot act. Every figure she gives came from a tool that
 * queried the chain or the extraction record, and the panel names those tools
 * under each answer so a number can be checked rather than believed. That is
 * the same argument the rest of the product makes — the validator is rules,
 * balances come from the chain — and an assistant is the easiest place to
 * quietly break it.
 *
 * The avatar is photoreal, which makes the "AI assistant" label under her name
 * load-bearing rather than decorative: someone asking what a note will pay
 * them should never be unsure whether a person told them.
 */

interface Turn {
  role: "user" | "zoya";
  text: string;
  sources?: { tool: string }[];
  /** The reply currently being streamed into. At most one, always the last. */
  streaming?: boolean;
}

/**
 * The thread this browser is in.
 *
 * Kept in local storage so a reload resumes rather than restarts, and sent with
 * every message. The transcript itself lives on the server — a browser that
 * supplied its own history could put words in her mouth and ask her to reason
 * from them.
 */
function conversationId(): string {
  const KEY = "zoya-conversation";
  let id = window.localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(KEY, id);
  }
  return id;
}

/** What a tool is doing, in words rather than a function name. */
function toolLabel(tool: string): string {
  return (
    {
      listNotes: "Listing the notes…",
      getNote: "Reading the note on-chain…",
      getSchedule: "Reading the repayment schedule…",
      getOffer: "Checking what is for sale…",
      getPosition: "Reading the position…",
      getPortfolio: "Reading your holdings…",
      getExtraction: "Reading the extracted terms…",
    }[tool] ?? "Reading…"
  );
}

export function Zoya() {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  /** The tool running right now, so the wait names what she is reading. */
  const [reading, setReading] = useState<string | null>(null);
  const [thread, setThread] = useState<string>();

  const { address } = useWallet();
  const pathname = usePathname();
  const endRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  /*
   * The review screen is dense along its bottom-right: settlement currency,
   * the provenance verdicts, the borrower wallet, the size of the offering,
   * and the submit bar under all of it. A launcher in that corner covers a
   * control whatever height it sits at. Its bottom-left is the document pane,
   * which scrolls and has nothing to click.
   */
  const onReview = pathname.startsWith("/review/");
  const onLanding = pathname === "/";

  // A note page is /note/[id], where the id is the extraction. Passing it lets
  // "what does this pay?" resolve without anyone quoting an id at her.
  const extractionId = pathname.startsWith("/note/")
    ? pathname.slice("/note/".length)
    : pathname.startsWith("/review/")
      ? pathname.slice("/review/".length)
      : undefined;

  // `crypto.randomUUID` and localStorage are browser-only, so the id is
  // resolved after mount rather than during render.
  useEffect(() => setThread(conversationId()), []);

  /* Restore the thread the first time the panel is opened, not on every mount:
     most visits never open it, and this is a database round trip. */
  const [clearing, setClearing] = useState(false);

  /**
   * Forgets the thread, on the server before the screen.
   *
   * The transcript is what Zoya reasons from on her next turn, so clearing only
   * the panel would leave her still answering from messages the person believes
   * they erased. If the request fails the messages stay on screen, which is the
   * honest outcome — they also still exist.
   */
  const clearThread = async () => {
    if (!thread || clearing || turns.length === 0) return;
    setClearing(true);
    try {
      const response = await fetch(
        `${BASE_URL}/zoya/messages?conversationId=${thread}`,
        { method: "DELETE", credentials: "include" },
      );
      if (response.ok) setTurns([]);
    } catch {
      // Left on screen deliberately: they were not deleted.
    } finally {
      setClearing(false);
    }
  };

  const restored = useRef(false);
  useEffect(() => {
    if (!open || !thread || restored.current) return;
    restored.current = true;

    void (async () => {
      try {
        const response = await fetch(
          `${BASE_URL}/zoya/messages?conversationId=${thread}`,
          { credentials: "include" },
        );
        const data = await response.json();
        setTurns(
          (data.messages ?? []).map(
            (message: { role: string; content: string; sources?: { tool: string }[] }) => ({
              role: message.role === "USER" ? "user" : "zoya",
              text: message.content,
              sources: message.sources ?? undefined,
            }),
          ),
        );
      } catch {
        // A thread that cannot be restored is not worth blocking the panel for.
      }
    })();
  }, [open, thread]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, busy]);

  /*
   * Close on a click outside, or on Escape.
   *
   * The panel floats over whatever the reader was doing, so the way out has to
   * be the one they will try first — which is clicking back at the page, not
   * hunting for the × in the corner.
   *
   * On pointerdown rather than click: a click that begins inside the panel and
   * ends outside it (selecting an answer to copy, and releasing over the page)
   * would otherwise close the panel mid-selection.
   */
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && !panelRef.current?.contains(target)) setOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const send = async () => {
    const message = draft.trim();
    if (!message || busy || !thread) return;

    setDraft("");
    setTurns((was) => [...was, { role: "user", text: message }]);
    setBusy(true);
    setReading(null);

    /*
     * Appends to the reply in flight, opening one if this is the first
     * fragment.
     *
     * Whether a reply is open is read from the turns themselves rather than
     * held in a variable the updater assigns to. It was the latter, and React
     * invokes an updater more than once in development — the first invocation
     * flipped the flag, so the second took the "append to the last turn"
     * branch and merged Zoya's reply into the user's own message. An updater
     * has to be a pure function of the state it is given.
     */
    let received = false;
    const append = (text: string, sources?: { tool: string }[]) =>
      setTurns((was) => {
        const last = was[was.length - 1];

        if (last?.role === "zoya" && last.streaming) {
          return [
            ...was.slice(0, -1),
            {
              ...last,
              text: last.text + text,
              sources: sources ?? last.sources,
            },
          ];
        }

        return [...was, { role: "zoya", text, sources, streaming: true }];
      });

    /** Seals the reply so nothing later can be appended to it. */
    const close = () =>
      setTurns((was) =>
        was.map((turn, index) =>
          index === was.length - 1 && turn.streaming
            ? { ...turn, streaming: false }
            : turn,
        ),
      );

    try {
      const response = await fetch(`${BASE_URL}/zoya/stream`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message,
          conversationId: thread,
          // The wallet is taken from the session server-side; sending it here
          // would only be a claim, and it is ignored.
          context: { extractionId },
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error(
          response.status === 401
            ? "Connect your wallet and sign in to ask Zoya."
            : "Zoya is not reachable right now.",
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // A frame ends at a blank line; the tail is a partial frame and waits
        // for the next chunk rather than being parsed half-formed.
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          const event = /^event: (.*)$/m.exec(frame)?.[1];
          const payload = /^data: (.*)$/m.exec(frame)?.[1];
          if (!event || !payload) continue;

          const data = JSON.parse(payload);
          if (event === "delta") {
            setReading(null);
            received = true;
            append(data.text);
          } else if (event === "tool") {
            setReading(data.tool);
          } else if (event === "done") {
            append("", data.sources);
          } else if (event === "error") {
            received = true;
            append(data.error ?? "Something went wrong.");
          }
        }
      }

      // A stream that ends without saying anything is a failure that looked
      // like a success; saying so beats an empty bubble.
      if (!received) append("I could not answer that. Try again.");
    } catch (cause) {
      append((cause as Error).message);
    } finally {
      close();
      setBusy(false);
      setReading(null);
    }
  };

  if (onLanding) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Ask Zoya"
        className={cn(
          "fixed z-50 flex items-center gap-2 rounded-full border border-border bg-card py-1.5 pl-1.5 pr-4 shadow-lg transition-colors hover:border-verified",
          onReview ? "bottom-28 left-4" : "bottom-4 right-4",
        )}
      >
        <Image
          src="/zoya.png"
          alt=""
          width={36}
          height={36}
          className="rounded-full"
        />
        <span className="text-sm font-medium">Ask Zoya</span>
      </button>
    );
  }

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Ask Zoya"
      className={cn(
        "fixed z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col rounded-xl border border-border bg-card shadow-2xl",
        onReview
          ? "bottom-28 left-4 h-[min(30rem,calc(100dvh-9rem))]"
          : "bottom-4 right-4 h-[min(34rem,calc(100dvh-2rem))]",
      )}
    >
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Image
          src="/zoya.png"
          alt=""
          width={36}
          height={36}
          className="shrink-0 rounded-full"
        />
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight">Zoya</p>
          <p className="text-[11px] leading-tight text-muted-foreground">
            AI assistant · reads only
          </p>
        </div>
        {turns.length > 0 ? (
          <button
            type="button"
            onClick={clearThread}
            disabled={clearing}
            title="Forget this conversation"
            className="ml-auto rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {clearing ? "Clearing…" : "Clear chat"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          className={cn(
            "flex size-8 items-center justify-center rounded text-muted-foreground hover:text-foreground",
            turns.length === 0 && "ml-auto",
          )}
        >
          <X className="size-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {turns.length === 0 ? (
          <div className="py-6 text-center">
            <MessageCircle className="mx-auto size-5 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">
              Ask about a note, what it pays, or why a mint is blocked.
            </p>
            <p className="mt-3 text-xs text-muted-foreground">
              She reads the chain and the extraction records. She cannot buy,
              sign, or move anything, and gives no investment advice.
            </p>
            {address ? (
              <p className="mt-3 text-xs text-muted-foreground">
                She can see this wallet&rsquo;s holdings — try{" "}
                <em>&ldquo;what do I hold?&rdquo;</em>
              </p>
            ) : null}
          </div>
        ) : null}

        {turns.map((turn, index) => (
          <div
            key={index}
            className={cn(
              "text-sm",
              turn.role === "user" ? "text-right" : "text-left",
            )}
          >
            <div
              className={cn(
                "inline-block max-w-[90%] rounded-lg px-3 py-2 text-left",
                turn.role === "user"
                  ? "whitespace-pre-wrap bg-muted"
                  : "border border-border bg-background",
              )}
            >
              {/* Only her side is formatted. A user who types an asterisk
                  means an asterisk. */}
              {turn.role === "zoya" ? (
                <RichText text={turn.text} />
              ) : (
                turn.text
              )}
            </div>
            {turn.sources?.length ? (
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                read {[...new Set(turn.sources.map((s) => s.tool))].join(", ")}
              </p>
            ) : null}
          </div>
        ))}

        {busy && reading ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> {toolLabel(reading)}
          </p>
        ) : busy ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Thinking…
          </p>
        ) : null}

        <div ref={endRef} />
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
        className="flex items-center gap-2 border-t border-border px-3 py-3"
      >
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask about a note…"
          aria-label="Message Zoya"
          disabled={busy}
          className="text-sm"
        />
        <Button type="submit" size="sm" disabled={busy || !draft.trim() || !thread}>
          <Send />
        </Button>
      </form>
    </div>
  );
}
