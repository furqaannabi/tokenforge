"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Reveals its children when they scroll into view.
 *
 * The resting state in CSS is *visible*. This component marks the document
 * first (`js-reveal`), which is what arms the hidden state — so if the script
 * never runs, or the observer never fires, the page still reads. Content that
 * depends on JavaScript to become visible is content that sometimes is not.
 *
 * Once only. An element that re-animates every time it passes the viewport
 * turns scrolling back through a page into a light show.
 */
export function Reveal({
  children,
  delay = 0,
  className,
  as: Tag = "div",
}: {
  children: React.ReactNode;
  /** Milliseconds, for staggering a row of siblings. */
  delay?: number;
  className?: string;
  as?: "div" | "li" | "section";
}) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    // Arming the hidden state here, rather than in the markup, is the whole
    // safety mechanism — see above.
    document.documentElement.classList.add("js-reveal");

    const node = ref.current;
    if (!node) return;

    /*
     * A margin so an element begins moving slightly before its top edge is
     * reached. Animating exactly at the boundary reads as late, because by the
     * time the eye lands on it the movement has already finished.
     */
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setShown(true);
        observer.disconnect();
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.15 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={ref as React.Ref<never>}
      className={cn("reveal", shown && "reveal-in", className)}
      style={{ ["--reveal-delay" as string]: `${delay}ms` }}
    >
      {children}
    </Tag>
  );
}

/**
 * The rule that draws itself across the pipeline.
 *
 * Purely decorative, and says so: it exists to make five cards read as one
 * ordered sequence rather than a row of unrelated tiles.
 */
export function Trace({ delay = 0 }: { delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setShown(true);
        observer.disconnect();
      },
      { threshold: 0.5 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden
      className={cn(
        "trace h-px bg-gradient-to-r from-verified/70 via-verified/40 to-transparent",
        shown && "trace-in",
      )}
      style={{ ["--reveal-delay" as string]: `${delay}ms` }}
    />
  );
}
