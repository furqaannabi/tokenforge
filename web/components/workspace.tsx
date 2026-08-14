"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useWallet } from "@/lib/wallet";
import { useIsRegistryAdmin } from "@/lib/registry";
import { cn } from "@/lib/utils";
import { AllNotesView } from "@/components/views/all-notes";
import { MyNotesView } from "@/components/views/my-notes";
import { IssueView } from "@/components/views/issue";
import { RegistryView } from "@/components/views/registry";
import { AdminView } from "@/components/views/admin";

/**
 * Everything that was a separate page.
 *
 * Browsing notes, holding them, issuing them and admitting issuers were five
 * routes, and four of them were empty for most visitors — a wallet that holds
 * nothing has no portfolio, an unregistered one cannot issue, and exactly one
 * address in the world can use the admin queue. Splitting them across the nav
 * advertised doors that would not open.
 *
 * They are one screen now, and a tab only appears when the chain says the
 * viewer can use it. The selection lives in the query string so a tab is still
 * a link someone can send.
 */

type TabId = "notes" | "mine" | "issue" | "registry" | "admin";

interface Tab {
  id: TabId;
  label: string;
  /** Shown only when true; undefined means always. */
  when?: boolean;
}

export function Workspace() {
  const router = useRouter();
  const params = useSearchParams();
  const { address, connected, issuer } = useWallet();
  const { isAdmin } = useIsRegistryAdmin(address);

  const tabs: Tab[] = [
    { id: "notes", label: "All notes" },
    { id: "mine", label: "My notes", when: connected },
    { id: "issue", label: "New note", when: Boolean(issuer?.verified) },
    { id: "registry", label: "Registry" },
    { id: "admin", label: "Admin", when: isAdmin },
  ];

  const visible = tabs.filter((tab) => tab.when !== false);

  /*
   * An unknown or newly-hidden tab falls back to the first rather than
   * rendering nothing. Disconnecting a wallet while on "My notes" would
   * otherwise leave the page blank.
   */
  const requested = params.get("view") as TabId | null;
  const active =
    requested && visible.some((tab) => tab.id === requested)
      ? requested
      : "notes";

  const select = (id: TabId) => {
    const next = new URLSearchParams(params.toString());
    if (id === "notes") next.delete("view");
    else next.set("view", id);
    const query = next.toString();
    router.replace(query ? `/?${query}` : "/", { scroll: false });
  };

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6 sm:py-8">
      {active === "notes" ? <AllNotesView /> : null}
      {active === "mine" ? <MyNotesView /> : null}
      {active === "issue" ? <IssueView /> : null}
      {active === "registry" ? <RegistryView /> : null}
      {active === "admin" ? <AdminView /> : null}
    </div>
  );
}
