import express from "express";
import path from "node:path";
import type { ErrorRequestHandler } from "express";
import { readPostingPage, PostingError } from "./posting-page";
import { parseJobPosting } from "./job-parser";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { saveJobSearch, getRecentSearches } from "./database";
import { normalizeRecruiterSearch, searchRecruiters, searchOfferPosts } from "./serper";

const envFile = path.join(__dirname, "../env_var.env");

if (existsSync(envFile)) {
  loadEnvFile(envFile);
}

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(express.json({
  limit: "10kb",
}));

app.post("/api/search", async (req, res) => {
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

app.post("/api/recruiters", async (req, res) => {
  const results = await searchRecruiters(req.body?.company, req.body?.team);
  res.json(results);
});

app.get("/api/recent-searches", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ searches: await getRecentSearches() });
});

// Serve the frontend from the same origin as the API.
app.post("/api/offer-posts", async (req, res) => {
  const results = await searchOfferPosts(req.body?.company);
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
  }

  res.status(status).json({
    error: message,
  });
};

app.use(handleError);

app.listen(port, "0.0.0.0", () => {
  console.log(`Find My Rec is running at http://localhost:${port}`);
});
