import type { Request, Response, NextFunction } from "express";
import { creditRpc } from "./credits";
import { PostingError } from "./posting-page";

// Reserve before doing work. Failed attempts also count toward abuse limits.
export async function reserveUsage(bucket: string, limit: number, seconds: number): Promise<void> {
  const accepted = await creditRpc("reserve_usage", {
    p_bucket: bucket,
    p_limit: limit,
    p_seconds: seconds,
  });

  if (accepted !== true) {
    throw new PostingError("Request limit reached. Please try again later.", 429);
  }
}

export async function accountLimit(_req: Request, res: Response, next: NextFunction): Promise<void> {
  // Share a single allowance across scraping, recruiters, and posts.
  await reserveUsage(`account:${res.locals.user.id}`, 20, 60);
  next();
}

function providerLimit(): number {
  const configured = process.env.SERPER_DAILY_REQUEST_LIMIT || "100";
  const limit = Number(configured);

  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new PostingError("Search usage limit is not configured correctly.", 503);
  }

  return limit;
}

export async function getGlobalUsage() {
  const used = await creditRpc("global_search_usage", {});

  if (!Number.isSafeInteger(used) || used < 0) {
    throw new PostingError("Usage count is unavailable.", 503);
  }

  return { used, limit: providerLimit() };
}

export async function reserveProviderCall(): Promise<void> {
  // Includes the owner account. No refund: a failed response may still cost money.
  await reserveUsage("serper:daily", providerLimit(), 86400);
}
