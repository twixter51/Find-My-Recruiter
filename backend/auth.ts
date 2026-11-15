import type { Request, Response, NextFunction } from "express";
import { PostingError } from "./posting-page";

const cookieName = "fmr_session";

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new PostingError("Account setup is not configured yet.", 503);
  }

  return { url, key };
}

// Passwords go directly to Supabase Auth; our database never stores them.
export async function authRequest(route: string, body?: unknown, token?: string) {
  const settings = config();
  const headers: Record<string, string> = {
    apikey: settings.key,
    "Content-Type": "application/json",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let method = "GET";

  if (body !== undefined) {
    method = "POST";
  }

  let response: globalThis.Response;

  try {
    response = await fetch(new URL(`/auth/v1/${route}`, settings.url), {
      method,
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
      redirect: "error",
    });
  } catch {
    throw new PostingError("Account service is unavailable. Please try again.", 503);
  }

  if (!response.ok) {
    if (response.status === 429) {
      throw new PostingError("Too many attempts. Please wait before trying again.", 429);
    }

    throw new PostingError("Could not authenticate. Check your credentials and confirm your email.", 401);
  }

  return response.json();
}

export function sessionToken(req: Request): string {
  const cookies = req.headers.cookie || "";

  for (const cookie of cookies.split(";")) {
    const [name, ...value] = cookie.trim().split("=");

    if (name === cookieName) {
      return value.join("=");
    }
  }

  return "";
}

export function setSession(res: Response, token: string, expires: number): void {
  // HttpOnly prevents scripts reading the access token. SameSite blocks cross-site use.
  res.cookie(cookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: Math.min(expires, 3600) * 1000,
  });
}

export function clearSession(res: Response): void {
  res.clearCookie(cookieName, { path: "/", sameSite: "strict", secure: process.env.NODE_ENV === "production" });
}

export async function requireUser(req: Request, res: Response, next: NextFunction) {
  const token = sessionToken(req);

  if (!token) {
    throw new PostingError("Sign up or log in to search.", 401);
  }

  // Validate against Supabase, never trust a browser-supplied user ID or balance.
  const user = await authRequest("user", undefined, token);

  if (!user.id || !user.email_confirmed_at) {
    throw new PostingError("Confirm your email before searching.", 403);
  }

  res.locals.user = { id: user.id, email: user.email };
  next();
}

export function sameOrigin(req: Request, _res: Response, next: NextFunction): void {
  if (req.method !== "GET" && req.method !== "HEAD") {
    const origin = process.env.APP_ORIGIN || "http://localhost:3000";

    if (req.headers.origin !== origin) {
      throw new PostingError("Request origin is not allowed.", 403);
    }
  }

  next();
}

export function credentials(body: unknown) {
  const value = body as { email?: unknown; password?: unknown };

  if (!value || typeof value.email !== "string" || typeof value.password !== "string") {
    throw new PostingError("Enter your email and password.", 400);
  }

  const email = value.email.trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || value.password.length < 8 || value.password.length > 128) {
    throw new PostingError("Use a valid email and a password of 8 to 128 characters.", 400);
  }

  return { email, password: value.password };
}

// Bounded, per-server throttle. Supabase also applies its own auth limits.
const attempts = new Map<string, { count: number; until: number }>();
export function throttle(req: Request, _res: Response, next: NextFunction): void {
  const key = `${req.ip}:${req.path}`;
  const now = Date.now();

  for (const [id, entry] of attempts) {
    if (entry.until <= now) {
      attempts.delete(id);
    }
  }

  let entry = attempts.get(key);

  if (!entry) {
    if (attempts.size >= 5000) {
      throw new PostingError("Server busy. Try again later.", 429);
    }

    entry = { count: 0, until: now + 60000 };
    attempts.set(key, entry);
  }

  entry.count += 1;

  if (entry.count > 10) {
    throw new PostingError("Too many requests. Please wait a minute.", 429);
  }

  next();
}
