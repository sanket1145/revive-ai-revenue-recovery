/**
 * Server-side read client for REVIVE's public reporting projections.
 *
 * Uses the publishable key (not the service role): every table it touches has
 * an explicit public SELECT policy, and the raw `transactions` ledger is
 * deliberately NOT one of them. Privileged work (running the generator or the
 * detector) uses the admin client instead.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export function getPublicSupabase() {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];

  if (!url || !key) {
    throw new Error(
      "Backend is not configured: SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY are missing.",
    );
  }

  return createClient<Database>(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    global: {
      // sb_publishable_* keys are opaque strings, not bearer JWTs.
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) {
          headers.delete("Authorization");
        }
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
  });
}
