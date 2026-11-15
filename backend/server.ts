import { authRequest, credentials, setSession, clearSession, requireUser, sameOrigin, throttle } from "./auth";
import { creditRpc, paidSearch, hasUnlimitedCredits } from "./credits";
import express from "express";
import { accountLimit, reserveUsage, getGlobalUsage } from "./usage-limits";
import path from "node:path";
import type { ErrorRequestHandler } from "express";
import { readPostingPage, PostingError } from "./posting-page";
import { parseJobPosting } from "./job-parser";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { saveJobSearch } from "./database";
import { normalizeRecruiterSearch, searchRecruiters, searchOfferPosts } from "./serper";

const envFile = path.join(__dirname, "../env_var.env");

if (existsSync(envFile)) {
  loadEnvFile(envFile);
}

const app = express();
const port = Number(process.env.PORT || 3000);

// Do not allow other sites to frame the app or receive job URLs as referrers.
app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

app.use(express.json({
  limit: "10kb",
  // Our frontend sends plain JSON; compressed request bodies are unnecessary.
  inflate: false,
}));

// Cookie-authenticated writes must originate from our configured app URL.
app.use("/api", sameOrigin);
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.post("/api/auth/signup", throttle, async (req, res) => {
  const input = credentials(req.body);
  // Bound email sends through this app, even across restarts or many IPs.
  await reserveUsage("signup:daily", 100, 86400);
  await authRequest("signup", input);
  res.json({ message: "Check your email to confirm your account, then log in here to continue." });
});

app.get("/api/usage", throttle, async (_req, res) => {
  res.json(await getGlobalUsage());
});

app.post("/api/auth/login", throttle, async (req, res) => {
  const session = await authRequest("token?grant_type=password", credentials(req.body));

  if (!session.access_token || !session.user?.email_confirmed_at) {
    throw new PostingError("Confirm your email before logging in.", 403);
  }

  setSession(res, session.access_token, session.expires_in);
  res.json({ ok: true });
});

app.post("/api/auth/logout", (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

app.get("/api/auth/me", throttle, requireUser, async (_req, res) => {
  if (hasUnlimitedCredits(res.locals.user.id)) {
    res.json({ id: res.locals.user.id, email: res.locals.user.email, unlimited: true });
    return;
  }

  const credits = await creditRpc("search_balance", { p_user: res.locals.user.id });
  res.json({ id: res.locals.user.id, email: res.locals.user.email, credits });
});

app.post("/api/search", throttle, requireUser, accountLimit, async (req, res) => {
  if (!hasUnlimitedCredits(res.locals.user.id)) {
    const balance = await creditRpc("search_balance", { p_user: res.locals.user.id });

    if (balance < 1) {
      throw new PostingError("No search credits left.", 402);
    }
  }

  // Read the page, then extract job details without company-specific rules.
  const page = await readPostingPage(req.body?.jobUrl);
  const job = parseJobPosting(page.html, page.sourceUrl);
  let saved = false;

  try {
    await saveJobSearch(job);
    saved = true;
  } catch {
    job.warnings.push("Job details were read, but this search could not be saved to the database.");
  }

  res.json({
    message: "Job details extracted. Open recruiter results to search for potential contacts.",
    job,
    saved,
    recruiterSearch: normalizeRecruiterSearch(job.company, job.team),
  });
});

app.post("/api/recruiters", throttle, requireUser, accountLimit, async (req, res) => {
  const input = req.body || {};
  const results = await paidSearch(
    res.locals.user.id,
    input.requestId,
    ["recruiters", input.company, input.team, input.forceRefresh, input.page],
    () => searchRecruiters(input.company, input.team, input.forceRefresh, input.page)
  );
  res.json(results);
});

// Serve the frontend from the same origin as the API.
app.post("/api/offer-posts", throttle, requireUser, accountLimit, async (req, res) => {
  const input = req.body || {};
  const results = await paidSearch(
    res.locals.user.id,
    input.requestId,
    ["posts", input.company, input.jobTitle, input.batch, input.forceRefresh],
    () => searchOfferPosts(input.company, input.jobTitle, input.batch, input.forceRefresh)
  );
  res.json(results);
});

const frontendDirectory = path.join(__dirname, "../../frontend");

app.use(express.static(frontendDirectory));

const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
  let status = 500;
  let message = "An unexpected server error occurred.";

  if (error instanceof PostingError) {
    status = error.status;
    message = error.message;
  } else if (error.status === 413) {
    status = 413;
    message = "Request is too large.";
  } else if (error.status === 400) {
    status = 400;
    message = "Request must contain valid JSON.";
  } else if (error.status === 415) {
    status = 415;
    message = "Send uncompressed JSON.";
  }

  res.status(status).json({
    error: message,
  });
};

app.use(handleError);

app.listen(port, "0.0.0.0", () => {
  console.log(`Find My Rec is running at http://localhost:${port}`);
});
