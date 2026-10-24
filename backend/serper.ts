import { extractOfferContacts } from "./offer-contacts";
import { acknowledgmentGroups, recruiterTerms } from "./offer-phrases";
import { PostingError } from "./posting-page";

interface Recruiter {
  name: string;
  linkedinUrl: string;
}

interface SearchResults {
  query: string;
  recruiters: Recruiter[];
  cache: SearchResponse["cache"];
}

// Repeated searches reuse results for ten minutes instead of spending credits.
const cache = new Map<string, { expires: number; results: unknown }>();
let searchInProgress = false;
let nextSearchTime = 0;

function cleanField(value: unknown, required: boolean): string {
  if (value === undefined && !required) {
    return "";
  }

  if (typeof value !== "string" || value.length > 200) {
    throw new PostingError("Search fields must be text of at most 200 characters.", 400);
  }

  // Keep user text from injecting search operators into our query.
  const cleaned = value.replace(/[^\p{L}\p{N}\s.&'-]/gu, " ").replace(/\s+/g, " ").trim();

  if (required && !cleaned) {
    throw new PostingError("Enter the company name before searching for recruiters.", 400);
  }

  return cleaned;
}

export function normalizeRecruiterSearch(company: string, team: string) {
  // Remove legal suffixes, but preserve multiword brands such as General Motors.
  let employer = company.trim();
  let previousName = "";

  while (employer !== previousName) {
    previousName = employer;
    employer = employer.replace(/[,\s]+(?:LLC|L\.L\.C\.|Inc\.?|Incorporated|Ltd\.?|Limited|Corp\.?|Corporation|PLC)\s*$/i, "").trim();
  }

  // Legal entities don't always reveal their public brand through suffixes alone.
  const companyAliases: Record<string, string> = {
    "amazon.com services": "Amazon",
    "amazon.com": "Amazon",
  };

  employer = companyAliases[employer.toLowerCase()] || employer;
  let specialty = team.trim();

  if (specialty.toLowerCase() === employer.toLowerCase()) {
    specialty = "";
  } else if (employer && specialty.toLowerCase().startsWith(`${employer.toLowerCase()} `)) {
    specialty = specialty.slice(employer.length).trim();
  }

  return { company: employer, team: specialty };
}

export function buildRecruiterQuery(company: unknown, team: unknown): string {
  const fields = normalizeRecruiterSearch(cleanField(company, true), cleanField(team, false));
  const employer = fields.company;
  const specialty = fields.team;
  const parts = ["site:linkedin.com/in/", `"${employer}"`];

  if (specialty) {
    // Separate quoted words allow different wording/order without search operators.
    for (const word of specialty.split(/\s+/)) {
      parts.push(`"${word}"`);
    }
  }

  parts.push('(recruiter OR "talent acquisition")');
  return parts.join(" ");
}

export function extractRecruiters(data: unknown): Recruiter[] {
  if (!data || typeof data !== "object") {
    throw new PostingError("The search service returned an unexpected response.", 502);
  }

  const organic = (data as Record<string, unknown>).organic;

  if (!Array.isArray(organic)) {
    throw new PostingError("The search service didn't return a results list.", 502);
  }

  const recruiters: Recruiter[] = [];
  const seen = new Set<string>();

  for (const item of organic) {
    if (!item || typeof item.title !== "string" || typeof item.link !== "string") {
      continue;
    }

    let url: URL;

    try {
      url = new URL(item.link);
    } catch {
      continue;
    }

    const isLinkedIn = url.hostname === "linkedin.com" || url.hostname.endsWith(".linkedin.com");
    const profile = url.pathname.match(/^\/in\/([^/]+)\/?$/);

    if (!isLinkedIn || !profile || url.protocol !== "https:" || url.username || url.password || url.port) {
      continue;
    }

    // The query targets recruiting, but Google may omit those words from
    // the preview. Keep valid profiles as unverified potential contacts.
    const profileId = profile[1].toLowerCase();

    if (seen.has(profileId)) {
      continue;
    }

    // Search titles usually begin with a name; this isn't identity verification.
    const name = item.title.split(/\s+[-–—|]\s+/)[0].trim();

    if (!name || name.length > 150) {
      continue;
    }

    seen.add(profileId);
    recruiters.push({
      name,
      linkedinUrl: `https://www.linkedin.com/in/${profile[1]}/`,
    });
  }

  return recruiters;
}

export async function searchRecruiters(company: unknown, team: unknown, forceRefresh: unknown = false, page: unknown = 1): Promise<SearchResults> {
  if (typeof forceRefresh !== "boolean") {
    throw new PostingError("Refresh must be true or false.", 400);
  }

  if (typeof page !== "number" || !Number.isInteger(page) || page < 1 || page > 15) {
    throw new PostingError("Page must be an integer from 1 to 15.", 400);
  }

  const query = buildRecruiterQuery(company, team);
  const result = await runSearch(query, page, forceRefresh);
  return {
    query,
    recruiters: extractRecruiters(result.data),
    cache: result.cache,
  };
}

export function buildOfferQuery(company: unknown, jobTitle: unknown, variation = 0): string {
  const employer = normalizeRecruiterSearch(cleanField(company, true), "").company;

  if (jobTitle !== undefined && typeof jobTitle !== "string") {
    throw new PostingError("Job title must be text.", 400);
  }

  // Drop posting-specific details while preserving the actual role wording.
  cleanField(jobTitle, false);
  let rawTitle = "";

  if (typeof jobTitle === "string") {
    rawTitle = jobTitle;
  }
  const title = cleanField(rawTitle.split(/,|\s[|\u2013\u2014-]\s|\(/)[0], false);
  const role = title
    .replace(/\b(?:internship|intern|co-op|new grad(?:uate)?|entry level)\b/gi, " ")
    .replace(/^(?:senior|junior|sr\.?|jr\.?)\s+/i, "")
    .replace(/\b20\d{2}\b/g, " ")
    .replace(/\b(?:summer|winter|fall|spring)\b/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s-]+|[\s-]+$/g, "");

  const parts = [
    '(site:linkedin.com/posts/ OR site:linkedin.com/feed/update/)',
    `"${employer}"`,
  ];

  if (role && variation < 2) {
    if (variation === 0) {
      parts.push(`"${role}"`);
    } else {
      const roleWords = role.split(/\s+/).map((word) => `"${word}"`);
      parts.push(`(${roleWords.join(" OR ")})`);
    }
  }

  const recruitingWords = recruiterTerms.map((word) => `"${word}"`).join(" OR ");
  const thanksWords = acknowledgmentGroups[variation].map((word) => `"${word}"`).join(" OR ");
  if (variation !== 1) {
    parts.push(`(${recruitingWords})`);
  }
  parts.push(`(${thanksWords})`);
  return parts.join(" ");
}

export function extractOfferPosts(data: unknown) {
  const organic = (data as { organic?: unknown } | null)?.organic;

  if (!Array.isArray(organic)) {
    throw new PostingError("The search service didn't return a results list.", 502);
  }

  const posts = [];
  const seen = new Set<string>();

  for (const item of organic) {
    if (!item || typeof item.title !== "string" || typeof item.link !== "string") {
      continue;
    }

    let url: URL;

    try {
      url = new URL(item.link);
    } catch {
      continue;
    }

    const isLinkedIn = url.hostname === "linkedin.com" || url.hostname.endsWith(".linkedin.com");
    const isPost = /^\/(posts\/[^/]+\/?|feed\/update\/urn:li:activity:\d+\/?)$/.test(url.pathname);

    if (!isLinkedIn || !isPost || url.protocol !== "https:" || url.username || url.password || url.port) {
      continue;
    }

    url.search = "";
    url.hash = "";

    if (seen.has(url.href)) {
      continue;
    }

    seen.add(url.href);
    let snippet = "";

    if (typeof item.snippet === "string") {
      snippet = item.snippet;
    }

    // Only analyze the snippet, not the author/title joined to it.
    // Joining separate fields can create a relationship the source never stated.
    const contacts = extractOfferContacts(snippet);

    posts.push({
      title: item.title,
      url: url.href,
      snippet,
      contacts,
    });
  }

  return posts;
}

export async function searchOfferPosts(company: unknown, jobTitle?: unknown, batch: unknown = 0, forceRefresh: unknown = false) {
  if (!Number.isInteger(batch) || typeof batch !== "number" || batch < 0 || batch >= 15) {
    throw new PostingError("Search batch must be an integer from 0 to 14.", 400);
  }

  if (typeof forceRefresh !== "boolean") {
    throw new PostingError("Refresh must be true or false.", 400);
  }

  const variation = batch % acknowledgmentGroups.length;
  const page = Math.floor(batch / acknowledgmentGroups.length) + 1;
  const query = buildOfferQuery(company, jobTitle, variation);
  const result = await runSearch(query, page, forceRefresh);
  return {
    query,
    batch,
    page,
    hasMore: batch < 14,
    posts: extractOfferPosts(result.data),
    cache: result.cache,
  };
}

interface SearchResponse {
  data: unknown;
  cache: { hit: boolean; expiresAt: number; remainingSeconds: number };
}

async function runSearch(query: string, page = 1, forceRefresh = false): Promise<SearchResponse> {
  const cacheKey = JSON.stringify({ query, page });
  const cached = cache.get(cacheKey);

  if (!forceRefresh && cached && cached.expires > Date.now()) {
    return makeSearchResponse(cached.results, cached.expires, true);
  }

  const apiKey = process.env.SERPER_API_KEY?.trim();

  if (!apiKey) {
    throw new PostingError("Set SERPER_API_KEY in backend/env_var.env, then restart the server.", 503);
  }

  if (searchInProgress || Date.now() < nextSearchTime) {
    throw new PostingError("Please wait a few seconds before searching again.", 429);
  }

  searchInProgress = true;
  nextSearchTime = Date.now() + 3000;

  try {
    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query, num: 10, page }),
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });

    if (response.status === 401 || response.status === 403) {
      throw new PostingError("Serper rejected the API key. Check your key and account access.", 502);
    }

    if (response.status === 402 || response.status === 429) {
      throw new PostingError("Serper's credit or rate limit was reached. Check your account and try later.", 429);
    }

    if (!response.ok) {
      throw new PostingError("Serper couldn't complete this search. Please try later.", 502);
    }

    const results: unknown = await response.json();

    if (cache.size >= 100) {
      cache.clear();
    }

    if (!results || !Array.isArray((results as { organic?: unknown }).organic)) {
      throw new PostingError("The search service returned an unexpected response.", 502);
    }

    const expires = Date.now() + 600000;
    cache.set(cacheKey, { expires, results });

    return makeSearchResponse(results, expires, false);
  } catch (error) {
    if (error instanceof PostingError) {
      throw error;
    }

    // Never return provider errors or request details that might contain secrets.
    throw new PostingError("Couldn't reach the search service or read its response. Please try again.", 502);
  } finally {
    searchInProgress = false;
  }
}

function makeSearchResponse(data: unknown, expiresAt: number, hit: boolean): SearchResponse {
  return {
    data,
    cache: {
      hit,
      expiresAt,
      remainingSeconds: Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)),
    },
  };
}
