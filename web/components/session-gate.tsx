"use client";

import { useWalletSession } from "@/lib/session";

/**
 * Runs the sign-in once, for the whole app.
 *
 * Renders nothing. It exists because the effect has to live somewhere mounted
 * on every screen and mounted only once — asking a second component for a
 * second signature would train people to approve wallet prompts without
 * reading them.
 */
export function SessionGate() {
  useWalletSession();
  return null;
}
