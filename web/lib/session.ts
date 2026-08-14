"use client";

import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSignMessage } from "wagmi";
import { BASE_URL } from "./api";
import { useWallet } from "./wallet";

/**
 * Proving the wallet to the service, once per connection.
 *
 * Connecting a wallet tells the browser who you are; it tells the service
 * nothing. Anyone can post an address. So the service issues a challenge, the
 * wallet signs it, and the session that follows lives in an httpOnly cookie —
 * unreadable to script, and revocable server-side because the token names a
 * row rather than carrying the claims itself.
 *
 * A signature, not a transaction: no gas, and it authorises no payment. The
 * message says so, because a wallet prompt people cannot read is one they
 * approve without reading.
 */

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    // Without this the cookie neither arrives nor comes back.
    credentials: "include",
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${response.status}).`);
  }
  return response.json() as Promise<T>;
}

/** Who the service believes you are, which is not always who is connected. */
export function useSession() {
  return useQuery({
    queryKey: ["session"],
    queryFn: () => json<{ address: string | null }>("/auth/me"),
    staleTime: 60_000,
    retry: false,
  });
}

/**
 * Signs in when a wallet connects, and out when it leaves.
 *
 * Mounted once, high in the tree. The guard against re-prompting matters: a
 * re-render that asks for another signature trains people to approve prompts
 * without reading them, which is the habit every wallet phishing attack needs.
 */
export function useWalletSession() {
  const { address, connected } = useWallet();
  const { signMessageAsync } = useSignMessage();
  const session = useSession();
  const queryClient = useQueryClient();
  const attempted = useRef<string | null>(null);

  const signedIn = session.data?.address;

  useEffect(() => {
    if (session.isPending) return;

    const wanted = address?.toLowerCase();

    /*
     * End the old session before anything else, on either exit.
     *
     * Disconnecting is obvious. Switching wallets is the one that catches
     * people out: replacing the cookie leaves the previous session live on the
     * server, so a copy of that cookie would still read the first wallet's
     * positions and its Zoya transcript long after the browser moved on. The
     * session belongs to the wallet that proved it, and stops when that wallet
     * does.
     */
    const gone = !connected && signedIn;
    const switched = connected && signedIn && wanted && signedIn !== wanted;

    if (gone || switched) {
      attempted.current = null;
      void json("/auth/logout", { method: "POST" })
        .catch(() => {})
        // Everything, not just the session: cached reads belong to the wallet
        // that fetched them, and showing them to the next one is the leak this
        // is meant to close.
        .then(() => queryClient.invalidateQueries());
      return;
    }

    if (!connected || !wanted) return;

    // Already proved, or already asked once for this address.
    if (signedIn === wanted || attempted.current === wanted) return;
    attempted.current = wanted;

    void (async () => {
      try {
        const { message } = await json<{ message: string }>("/auth/nonce", {
          method: "POST",
          body: JSON.stringify({ address }),
        });
        const signature = await signMessageAsync({ message });
        await json("/auth/verify", {
          method: "POST",
          body: JSON.stringify({ address, signature }),
        });
        await queryClient.invalidateQueries();
      } catch {
        // Declining the prompt is a choice, not an error worth shouting about.
        // The reads that need a session will say so themselves.
      }
    })();
  }, [connected, address, signedIn, session.isPending, signMessageAsync, queryClient]);

  return {
    address: signedIn ?? null,
    /** Connected, but the service has not been shown a signature yet. */
    needsSignature: Boolean(connected && address && signedIn !== address.toLowerCase()),
  };
}
