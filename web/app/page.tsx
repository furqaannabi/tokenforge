import type { Metadata } from "next";
import { Landing } from "@/components/landing";

export const metadata: Metadata = {
  title: "TokenForge — real loan agreements, provably on-chain",
  description:
    "Verified issuers turn signed loan agreements into ERC-20 notes on X Layer. AI reads the terms with per-field confidence, a validator checks them, a human reviews what is shaky, and holders are paid as the borrower repays.",
};

/**
 * The landing page.
 *
 * The application moved to /app when this took the root, so that a first-time
 * visitor meets an explanation rather than an empty workspace and a connect
 * button.
 */
export default function Home() {
  return <Landing />;
}
