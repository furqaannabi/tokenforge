import { Suspense } from "react";
import { Workspace } from "@/components/workspace";

/**
 * The whole application, minus the two detail screens.
 *
 * `Workspace` reads the selected tab from the query string, and `useSearchParams`
 * has no answer during prerender — so the Suspense boundary is what lets this
 * route stay static instead of becoming server-rendered on every request.
 */
export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-[60vh]" />}>
      <Workspace />
    </Suspense>
  );
}
