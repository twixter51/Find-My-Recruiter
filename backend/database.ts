import { PostingError } from "./posting-page";

interface SavedJob {
  sourceUrl: string;
  title: string;
  company: string;
}

async function databaseRequest(query: string, body?: SavedJob): Promise<Response> {
  const projectUrl = process.env.SUPABASE_URL?.trim();
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();

  if (!projectUrl || !secretKey) {
    throw new PostingError("Database setup is incomplete. Configure Supabase and restart the server.", 503);
  }

  const url = new URL(`/rest/v1/job_searches${query}`, projectUrl);

  if (url.protocol !== "https:") {
    throw new PostingError("SUPABASE_URL must use HTTPS.", 503);
  }

  try {
    const response = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: {
        apikey: secretKey,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: body ? JSON.stringify({
        job_url: body.sourceUrl,
        title: body.title,
        company: body.company,
      }) : undefined,
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    });

    if (!response.ok) {
      throw new Error("Database request failed.");
    }

    return response;
  } catch {
    // Never expose provider responses or credentials to the browser.
    throw new PostingError("Couldn't access saved searches. Check the database setup and try again.", 503);
  }
}

export async function saveJobSearch(job: SavedJob): Promise<void> {
  await databaseRequest("", job);
}

export async function getRecentSearches() {
  const response = await databaseRequest("?select=id,title,company,created_at&order=created_at.desc,id.desc&limit=10");
  const searches: unknown = await response.json();

  if (!Array.isArray(searches)) {
    throw new PostingError("The database returned an unexpected response.", 502);
  }

  return searches;
}
