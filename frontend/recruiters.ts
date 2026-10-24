// This page calls our backend. The Serper key stays on the server.
interface Recruiter {
  name: string;
  linkedinUrl: string;
}

function showRecruiterResults(recruiters: Recruiter[], seen: Set<string>): number {
  const list = document.querySelector<HTMLUListElement>("#recruiter-list");
  const status = document.querySelector<HTMLParagraphElement>("#recruiter-status");

  if (!list || !status) {
    throw new Error("The recruiter results elements are missing.");
  }

  let added = 0;

  for (const recruiter of recruiters) {
    let profileUrl: URL;

    try {
      profileUrl = new URL(recruiter.linkedinUrl);
    } catch {
      continue;
    }

    const isLinkedIn = profileUrl.hostname === "linkedin.com"
      || profileUrl.hostname.endsWith(".linkedin.com");
    const isProfile = /^\/in\/[^/]+\/?$/.test(profileUrl.pathname);

    if (!isLinkedIn || !isProfile || profileUrl.protocol !== "https:") {
      continue;
    }

    if (profileUrl.username || profileUrl.password || profileUrl.port || !recruiter.name.trim()) {
      continue;
    }

    const identity = profileUrl.pathname.replace(/\/$/, "").toLowerCase();

    if (seen.has(identity)) {
      continue;
    }

    seen.add(identity);
    added += 1;
    const item = document.createElement("li");
    const name = document.createElement("strong");
    const link = document.createElement("a");

    name.textContent = recruiter.name;
    link.textContent = "View LinkedIn profile";
    link.href = profileUrl.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", `View ${recruiter.name}'s LinkedIn profile`);

    item.append(name, link);
    list.append(item);
  }

  list.hidden = list.childElementCount === 0;

  return added;
}

function initializeRecruiterPage(): void {
  const context = document.querySelector<HTMLParagraphElement>("#recruiter-context");

  if (!context) {
    return;
  }

  const parameters = new URLSearchParams(window.location.search);
  const notice = parameters.get("notice");

  if (notice) {
    const message = document.createElement("p");
    message.className = "note";
    message.textContent = notice;
    context.after(message);
  }

  const jobTitle = parameters.get("title");
  const employer = parameters.get("company");

  if (jobTitle && employer) {
    context.textContent = `${jobTitle} at ${employer}`;
  } else if (jobTitle) {
    context.textContent = jobTitle;
  } else {
    context.textContent = "Start by reading a job posting on the previous page.";
  }

  const searchForm = document.querySelector<HTMLFormElement>("#recruiter-search-form");
  const companyInput = document.querySelector<HTMLInputElement>("#search-company");
  const teamInput = document.querySelector<HTMLInputElement>("#search-team");
  const searchStatus = document.querySelector<HTMLParagraphElement>("#recruiter-status");
  const queryLabel = document.querySelector<HTMLParagraphElement>("#recruiter-query");
  const list = document.querySelector<HTMLUListElement>("#recruiter-list");
  const button = searchForm?.querySelector<HTMLButtonElement>('button[type="submit"]');

  if (!searchForm || !companyInput || !teamInput || !searchStatus || !queryLabel || !list || !button) {
    throw new Error("Recruiter search controls are missing.");
  }

  companyInput.value = employer || "";
  teamInput.value = parameters.get("team") || "";
  const refreshButton = document.querySelector<HTMLButtonElement>("#refresh-recruiters");
  const resetButton = document.querySelector<HTMLButtonElement>("#reset-recruiters");
  const historyNote = document.querySelector<HTMLElement>("#recruiter-history-note");
  const storageKey = "find-my-rec:recruiter-history:v1";
  let savedPages: Record<string, number> = {};
  const seen = new Set<string>();
  let nextPage = 1;
  let busy = false;
  let searchVersion = 0;

  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "null");

    if (saved && Array.isArray(saved.seen) && saved.pages && typeof saved.pages === "object") {
      savedPages = saved.pages;

      for (const id of saved.seen) {
        if (typeof id === "string") {
          seen.add(id);
        }
      }
    }
  } catch {
    // Keep the current page usable when storage is unavailable.
  }

  const historyKey = (): string => {
    return JSON.stringify([companyInput.value.trim().toLowerCase(), teamInput.value.trim().toLowerCase()]);
  };

  const restorePage = (): void => {
    nextPage = 1;
    const savedPage = savedPages[historyKey()];

    if (Number.isInteger(savedPage) && savedPage >= 1 && savedPage <= 16) {
      nextPage = savedPage;
    }

    button.disabled = busy || nextPage > 15;
  };

  const saveHistory = (): void => {
    savedPages[historyKey()] = nextPage;

    try {
      localStorage.setItem(storageKey, JSON.stringify({ seen: Array.from(seen), pages: savedPages }));

      if (historyNote) {
        historyNote.textContent = `${seen.size} profiles remembered in this browser.`;
      }
    } catch {
      if (historyNote) {
        historyNote.textContent = "History only lasts for this page: browser storage is unavailable.";
      }
    }
  };

  restorePage();
  saveHistory();

  resetButton?.addEventListener("click", () => {
    searchVersion += 1;
    seen.clear();
    savedPages = {};
    nextPage = 1;
    saveHistory();
    list.replaceChildren();
    list.hidden = true;
    queryLabel.textContent = "";
    searchStatus.textContent = "History reset. Previous profiles can appear again.";
    button.textContent = "Find recruiters";
    restorePage();
  });

  searchForm.addEventListener("input", () => {
    searchVersion += 1;
    list.replaceChildren();
    list.hidden = true;
    restorePage();
    queryLabel.textContent = "";
    searchStatus.textContent = "Search again to use the updated details.";
  });

  searchForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (busy) {
      return;
    }

    const submittedVersion = searchVersion;
    const forceRefresh = event.submitter === refreshButton;
    let page = nextPage;

    if (forceRefresh && page > 15) {
      page = 1;
    }

    if (page > 15) {
      return;
    }

    busy = true;
    button.disabled = true;

    if (refreshButton) {
      refreshButton.disabled = true;
    }
    queryLabel.textContent = "";
    searchStatus.textContent = "Searching for recruiter profiles...";

    try {
      const response = await fetch("/api/recruiters", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          company: companyInput.value.trim(),
          team: teamInput.value.trim(),
          forceRefresh,
          page,
        }),
        signal: AbortSignal.timeout(20000),
      });

      const data = await response.json();

      if (submittedVersion !== searchVersion) {
        return;
      }

      if (!response.ok) {
        throw new Error(data.error || "The search couldn't be completed.");
      }

      if (!Array.isArray(data.recruiters) || typeof data.query !== "string") {
        throw new Error("The server returned an unexpected response.");
      }

      const profiles = data.recruiters.filter((value: unknown): value is Recruiter => {
        if (!value || typeof value !== "object") {
          return false;
        }

        const record = value as Record<string, unknown>;
        return typeof record.name === "string" && typeof record.linkedinUrl === "string";
      });

      if (forceRefresh) {
        list.replaceChildren();
      }

      const added = showRecruiterResults(profiles, seen);
      nextPage = page + 1;
      saveHistory();
      queryLabel.textContent = `Page ${page}: ${data.query}`;
      button.textContent = "Find more recruiters";
      searchStatus.textContent = `${added} new, ${list.childElementCount} shown.`;

      if (added === 0) {
        searchStatus.textContent = "No unseen profiles on this page. Try the next page.";
      }

      if (nextPage > 15) {
        searchStatus.textContent += " End of pages. Refresh to check again, or reset history.";
      }

      if (data.cache?.hit) {
        searchStatus.textContent += " (cached)";
      }
    } catch (error) {
      if (submittedVersion !== searchVersion) {
        return;
      }

      if (error instanceof TypeError) {
        searchStatus.textContent = "Couldn't reach the server. Make sure it is running.";
      } else if (error instanceof Error) {
        searchStatus.textContent = error.message;
      } else {
        searchStatus.textContent = "Search failed. Please try again.";
      }
    } finally {
      busy = false;
      restorePage();

      if (refreshButton) {
        refreshButton.disabled = false;
      }
    }
  });
}

initializeRecruiterPage();
