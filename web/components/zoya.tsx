"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Loader2, MessageCircle, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWallet } from "@/lib/wallet";
import { BASE_URL } from "@/lib/api";
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

export function Zoya() {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [thread, setThread] = useState<string>();

  const { address } = useWallet();
  const pathname = usePathname();
  const endRef = useRef<HTMLDivElement>(null);

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
  const restored = useRef(false);
  useEffect(() => {
    if (!open || !thread || restored.current) return;
    restored.current = true;

    void (async () => {
      try {
        const response = await fetch(
          `${BASE_URL}/zoya/messages?conversationId=${thread}`,
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

  const send = async () => {
    const message = draft.trim();
    if (!message || busy || !thread) return;

    setDraft("");
    setTurns((was) => [...was, { role: "user", text: message }]);
    setBusy(true);

    try {
      const response = await fetch(`${BASE_URL}/zoya/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message,
          conversationId: thread,
          context: { extractionId, address },
        }),
      });
      const data = await response.json();

      setTurns((was) => [
        ...was,
        {
          role: "zoya",
          text: data.reply ?? data.error ?? "Something went wrong.",
          sources: data.sources,
        },
      ]);
    } catch (cause) {
      setTurns((was) => [
        ...was,
        { role: "zoya", text: (cause as Error).message },
      ]);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Ask Zoya"
        className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border border-border bg-card py-1.5 pl-1.5 pr-4 shadow-lg transition-colors hover:border-verified"
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
    <div className="fixed bottom-4 right-4 z-50 flex h-[min(34rem,calc(100dvh-2rem))] w-[min(24rem,calc(100vw-2rem))] flex-col rounded-xl border border-border bg-card shadow-2xl">
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
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="ml-auto flex size-8 items-center justify-center rounded text-muted-foreground hover:text-foreground"
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
                "inline-block max-w-[90%] rounded-lg px-3 py-2 text-left whitespace-pre-wrap",
                turn.role === "user"
                  ? "bg-muted"
                  : "border border-border bg-background",
              )}
            >
              {turn.text}
            </div>
            {turn.sources?.length ? (
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                read {[...new Set(turn.sources.map((s) => s.tool))].join(", ")}
              </p>
            ) : null}
          </div>
        ))}

        {busy ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Reading…
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
