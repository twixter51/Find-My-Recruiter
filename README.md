# Find My Rec

**Turn a job posting into a starting point for finding recruiter contacts.**

Find My Rec is a student-built MVP that reads public job postings and helps you discover potential recruiters through Google search results provided by Serper. It also finds LinkedIn offer announcements that may mention people involved in recruiting.

**Status:** MVP · **Frontend:** HTML, CSS & TypeScript · **Backend:** Node.js & Express

---

## Features

- **Read job postings** — extract the title, company, locations, team, and description when available.
- **Find potential recruiters** — search LinkedIn profiles by company and optional specialty.
- **Explore offer announcements** — find internship and early-career posts, with possible contact names when a search preview explicitly includes a thank-you mention. (Experimental)
- **Try sample jobs** — use, copy, or open Amazon and Zip posting links directly from the home page.
- **Reuse recent searches** — cache results for ten minutes to reduce repeated API calls.

> Results are leads to investigate. A profile does not confirm that someone recruits for a particular opening. A person thanked in a post may be a mentor or interviewer.

## How it works

```text
Paste a job URL
      |
      v
Fetch the public page and extract job details
      |
      v
Review the company and optional specialty
      |
      +-- Find recruiters -----> LinkedIn profile search
      |
      +-- Find offer posts ----> Announcement links and possible mentions
```

Express serves both the frontend and API. The backend sends search queries to Serper, filters the results, and returns them to the browser. The API key stays on the server.

LinkedIn pages are not directly scraped. Offer-post analysis uses the search previews returned by Serper.

For recruiter searches, `Amazon.com Services LLC` becomes `Amazon` and `Amazon Robotics` becomes the specialty `Robotics`. The original employer name remains in the extracted job details.

## Quick start

### 1. Install dependencies

Use Node.js 24 and npm. From the project directory containing `package.json`, run:

```sh
npm ci
```

### 2. Add your Serper key

Create `backend/env_var.env`:

```dotenv
SERPER_API_KEY=your_serper_api_key_here
```

This file is excluded by `.gitignore`. Keep it out of your repository and never put the key in frontend code. Job extraction works without a key; recruiter and offer-post searches require one.

### 3. Start the app

```sh
npm start
```

Open **[http://localhost:3000](http://localhost:3000)**. The start command compiles both frontend and backend TypeScript before starting Express.

If PowerShell blocks `npm.ps1`, use `npm.cmd` instead of `npm`.

## Try the demo

1. Select **Use sample** under Amazon or Zip, or paste your own public job URL.
2. Select **Read job posting**.
3. The app takes you directly to recruiter search with the company and specialty filled in.
4. Review the company and specialty, then select **Find recruiters**.
5. Try **Find recruiters mentioned in offer posts** for another way to find contacts.

When a preview includes a possible contact, open the original LinkedIn post to review the name and context.

If results are too narrow, clear the optional specialty. Sample postings are real listings and may close or change.

## Development

| Command | Purpose |
| --- | --- |
| `npm start` | Compile the frontend and backend, then start Express. |
| `npm run build` | Compile both without starting the server. |
| `npm run watch` | Recompile **frontend only** when its TypeScript changes. |

Edit `.ts` source files, not the generated JavaScript in `dist/`.

- **Backend or environment changes:** press Ctrl+C and run `npm start` again.
- **Frontend TypeScript changes:** rebuild or use watch mode, then reload the browser.
- **HTML or CSS changes:** reload the browser.

## Project structure

```text
Find_My_Rec/
├── backend/
│   ├── server.ts          # Routes, environment loading, static files
│   ├── posting-page.ts    # Public-page fetching and URL checks
│   ├── job-parser.ts      # General job-detail extraction
│   ├── serper.ts          # Search queries, filtering, cache
│   ├── env_var.env        # Local key; not committed
│   ├── tsconfig.json
│   └── dist/              # Generated JavaScript
├── frontend/
│   ├── index.html         # Job form, samples, extracted details
│   ├── main.ts            # Job form and sample-button behavior
│   ├── recruiters.html    # Recruiter and offer-post results page
│   ├── recruiters.ts      # Direct recruiter searches
│   ├── offer-posts.ts     # Offer-announcement searches
│   ├── styles.css
│   ├── tsconfig.json
│   └── dist/              # Generated JavaScript
├── package.json
├── package-lock.json
├── .gitignore
└── ReadMe.md
```

## API routes

All routes accept JSON through `POST` requests.

| Route | Request fields | Returns |
| --- | --- | --- |
| `/api/search` | `jobUrl` | Job details and normalized search defaults. |
| `/api/recruiters` | `company`, optional `team` | Search query and potential recruiter profiles. |
| `/api/offer-posts` | `company`, optional `jobTitle` | Search query, announcement links, previews, and possible names. |

Offer-post searches use the company and an editable job title. Queries require recruiting terms and acknowledgment phrases, without requiring "accepted" or "joining". Posting dates, internship labels, and team suffixes are removed from the role where recognizable. Leave the role blank for a broader search. Names remain unverified and are extracted only from search previews.

## Tech stack

| Layer | Technology |
| --- | --- |
| Interface | HTML, CSS, TypeScript |
| Server | Node.js, Express, TypeScript |
| HTML parsing | Cheerio |
| Search provider | Serper |
| Network address checks | ipaddr.js |
| Temporary cache | In-memory JavaScript `Map` |

Job searches persist in Supabase PostgreSQL. This demo has shared history and no user authentication. The Serper cache remains separate and temporary.

## Set up the database

1. Create a project at [Supabase](https://supabase.com/dashboard).
2. Open its SQL Editor and run [database/schema.sql](database/schema.sql).
3. Find the project URL and a **secret API key** in the project's connection/API settings. Use the new `sb_secret_...` key, not a publishable or legacy key.
4. Add these variables to `backend/env_var.env`, keeping your existing Serper key:

   ```dotenv
   SUPABASE_URL=https://your-project-ref.supabase.co
   SUPABASE_SECRET_KEY=sb_secret_your_key
   ```

5. Restart with `npm start`, read a sample job, and check Recent searches.
6. Restart again and refresh the page. The saved entry should remain. Confirm the record also appears in Supabase's `job_searches` table.

The backend saves the job URL, title, company, and database-generated timestamp. `GET /api/recent-searches` exposes only the ten latest titles, companies, dates, and IDs. History is shared across visitors. RLS is enabled, with direct access restricted to the backend's secret key. Never put that key in frontend code or GitHub.

If saving fails, extracted job details still appear with a warning; they are not falsely marked as saved. Live persistence must be verified after configuring the hosted project. On deployment, add the Supabase variables to the host's environment settings too.

## MVP limitations

- **Not all postings are readable.** Sign-in requirements, bot protection, and JavaScript-rendered pages can prevent extraction. Fields may be missing.
- **Job-page detection needs improvement.** A valid public URL is not necessarily a job posting; unrelated pages may produce incomplete or misleading details.
- **Previews are incomplete.** Search snippets may omit acknowledgments. Name detection is a simple heuristic; check the original post to verify context.
- **Results are limited.** Each provider request asks for up to ten results before filtering. Offer-post searches support batches and forced refresh; direct profile searches now support up to 15 pages.
- **The cache is temporary.** Identical queries reuse results for ten minutes. Restarting the server clears them, and separate server instances do not share the cache.
- **Usage controls are basic.** A shared cooldown limits searches, but there are no per-user quotas or overall spending caps.

## Deployment status

The app currently binds to `127.0.0.1` for local use. It uses the `PORT` environment variable when set, otherwise port `3000`.

Before deploying, adapt the server binding and configuration for the selected host, set `SERPER_API_KEY` through the host's environment settings, and test the full workflow on the public URL. Do not upload the local environment file.

## Roadmap
- [ ] Add a storage for potential words that thank you posts can have, redo the thank you post functionality.
- [ ] Add pagination and an explicit search-refresh option.
- [ ] Improve job-page validation and extraction across more employers.
- [ ] Refine the visual design and loading states.
- [ ] Improve offer-post name detection and contact relevance.
- [ ] Add usage limits before broader public access.
- [ ] Consider saved searches and accounts after validating the core workflow.


## Recruiter thank-you post search

Acknowledgment groups and recruiting terms live in `backend/offer-phrases.ts`.
The job role stays specific to the posting and is editable before searching.

- Each click of **Find more posts** advances to a different phrase group, then to the next results page. There are three groups across five pages (15 batches).
- The browser stores seen post IDs and per-company/role search progress in localStorage. Reloading resumes progress and skips previously seen posts. New results are not guaranteed.
- Preview mentions and acknowledgment text are optional. Search results remain visible even if Google omits the relevant part of the post. Visible mentions are shown as unverified leads; otherwise the user is prompted to open the post.
- Each cycle starts with company + exact role + recruiting + acknowledgment wording, then tries broader role words without mandatory recruiting terms, then company + recruiting + acknowledgment wording without a role restriction.
- These are candidate posts, not verified offers or recruiter endorsements. The app does not fetch full LinkedIn posts.

- The cache indicator shows whether the current batch was fetched fresh or reused, plus its remaining ten-minute cache time.
- **Refresh for new posts** advances to the next batch, bypasses its cache, and replaces the displayed list with unseen posts after a successful response. After all batches, it rechecks from the start. It does not clear unrelated entries or bypass the shared cooldown. Provider-side caching and identical search results are still possible.
- New batches and forced refreshes may consume Serper credits. A failed request can be retried without skipping that batch.


### Identifying contacts from post previews

`backend/offer-contacts.ts` extracts names directly associated with recruiter or talent-acquisition role wording, such as "my recruiter, Nancy Li" or "Nancy Li, my recruiter". It handles names without an @ symbol. Each suggested contact includes the matching text as evidence and the original post link for manual review.

Generic thank-you names and @handles are not automatically classified as recruiters. Posts without a clear recruiter name remain visible for manual inspection. This is heuristic extraction from search snippets, not verification of LinkedIn tags, identity, current employment, or recruiting ownership. Query variants, deduplication, cache countdown, and forced refresh remain available.


### Browser history and page layout

Both pages use a responsive, shared visual style. **Find new posts** appends unseen posts; **Refresh for new posts** replaces the list with unseen results from a fresh request. **Reset seen history** clears all remembered post IDs and search positions for this app in the current browser, allowing earlier posts to appear again. This does not delete Supabase job history. Browser storage is local to the device and origin; clearing site data also resets it. If storage is blocked or full, a visible message explains that deduplication only lasts for the current page. No new posts is a valid outcome; the app never promises that Google has more unique results.


### Recruiter pages and resets

Normal recruiter searches now request successive pages (up to 15) and skip profile IDs already shown in this browser. Progress is saved per company and specialty. Refresh results fetches the next page without using the application cache and replaces the displayed list with unseen profiles. At the page limit, refresh rechecks from page one while retaining seen history.

Reset recruiter history clears all remembered recruiter profiles and page positions; Reset seen history in the post section clears all remembered posts and post-search positions. Each clears that section's display and restarts at page one/the first batch. Neither deletes Supabase job searches or clears the shared server cache. Repeat results can appear after a reset. Failures do not advance search progress.


## Security follow-ups

The current MVP has basic protections, but has not undergone a full security audit. Address these items before broader public use:

- [ ] **Rotate exposed credentials.** Revoke any API keys shared accidentally and update the replacements locally and in Render. Never commit secret values.
- [ ] **Limit API abuse.** Add per-IP rate limits to job fetching, recruiter searches, and post searches. Configure client-IP handling correctly behind the hosting proxy.
- [ ] **Cap search spending.** Enforce a daily provider-request budget, including pagination and forced refreshes. Keep the budget effective across restarts and multiple server instances.
- [ ] **Prevent database spam.** Limit job-search submissions and define a retention policy for saved records.
- [ ] **Review history privacy.** Recent job titles, companies, and dates are shared publicly in this demo. Retain the notice and implement per-user access controls before offering private search history.
- [ ] **Test URL-fetching protections.** Verify SSRF defenses against private and loopback addresses, IPv6 variants, redirects, and DNS rebinding. Retain response-size and timeout limits.

Existing protections include backend-only API keys, Git-ignored environment files, text-based rendering of external content, and public-address checks for fetched job pages. These reduce risk but do not replace the work above. Prioritize credential rotation, rate limits, and a total search budget.
