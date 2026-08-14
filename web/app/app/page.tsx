import { Suspense } from "react";
import { Workspace } from "@/components/workspace";

/**
 * The application itself.
 *
 * This used to be the site root; `/` is now the landing page, and everything
 * that means "back to the app" points here.
 *
 * `Workspace` reads the selected tab from the query string, and `useSearchParams`
 * has no answer during prerender — so the Suspense boundary is what lets this
 * route stay static instead of becoming server-rendered on every request.
 */
export default function AppPage() {
  return (
    <Suspense fallback={<div className="min-h-[60vh]" />}>
      <Workspace />
    </Suspense>
  );
}
