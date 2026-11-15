import { createHash } from "node:crypto";
import { PostingError } from "./posting-page";

// Owner access is configured here, never from a browser request or local storage.
// Only compare this with the user ID verified by Supabase Auth.
export function hasUnlimitedCredits(userId: string): boolean {
  return userId === "e2c5177d-a77e-431c-b53a-3fd0b414cac9";
}

export async function creditRpc(name: string, body: Record<string, unknown>) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    throw new PostingError("Credit storage is not configured.", 503);
  }

  try {
    const response = await fetch(new URL(`/rest/v1/rpc/${name}`, url), {
      method: "POST",
      headers: { apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
      redirect: "error",
    });

    if (!response.ok) {
      throw new Error("RPC failed");
    }

    return await response.json();
  } catch {
    throw new PostingError("Could not access your credits. Try again shortly.", 503);
  }
}

export async function paidSearch(userId: string, requestId: unknown, fingerprint: unknown, search: () => Promise<unknown>) {
  if (typeof requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    throw new PostingError("A valid search request ID is required.", 400);
  }

  const hash = createHash("sha256").update(JSON.stringify(fingerprint)).digest("hex");
  // Unlimited accounts still require login and pass the route's rate limit.
  // They do not reserve credits, so they do not need credit refunds.
  if (hasUnlimitedCredits(userId)) {
    const result = await search();
    return { ...(result as Record<string, unknown>), unlimited: true };
  }

  const args = { p_user: userId, p_request: requestId };
  const claim = await creditRpc("claim_search", { ...args, p_fingerprint: hash });

  if (claim.state === "complete") {
    return { ...claim.result, credits: claim.credits };
  }

  if (claim.state === "empty") {
    throw new PostingError("No search credits left.", 402);
  }

  if (claim.state !== "claimed") {
    throw new PostingError("This request is pending or already failed. Wait, or start a new search.", 409);
  }

  let result: unknown;

  try {
    result = await search();
  } catch (error) {
    await creditRpc("finish_search", { ...args, p_result: null, p_success: false });
    throw error;
  }

  // Never refund after provider success merely because saving failed: retrying
  // that case could allow repeated paid API calls. Pending rows need reconciliation.
  const credits = await creditRpc("finish_search", { ...args, p_result: result, p_success: true });
  return { ...(result as Record<string, unknown>), credits };
}
