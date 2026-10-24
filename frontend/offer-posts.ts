// IDs stay in this browser; no account or private profile data is stored.
const offerHistoryKey = "find-my-rec:offer-history:v1";
interface OfferHistory {
  seen: string[];
  cursors: Record<string, number>;
}

function readOfferHistory(): OfferHistory {
  try {
    const saved = JSON.parse(localStorage.getItem(offerHistoryKey) || "null");

    if (saved && Array.isArray(saved.seen) && saved.cursors && typeof saved.cursors === "object") {
      return {
        seen: saved.seen.filter((id: unknown) => typeof id === "string"),
        cursors: saved.cursors,
      };
    }
  } catch {
    // Storage can be unavailable in private or restricted browsers.
  }

  return { seen: [], cursors: {} };
}

// Offer searches are separate so they don't replace the direct recruiter results.
function initializeOfferSearch(): void {
  const button = document.querySelector<HTMLButtonElement>("#find-offer-posts");
  const companyInput = document.querySelector<HTMLInputElement>("#search-company");
  const status = document.querySelector<HTMLParagraphElement>("#offer-status");
  const list = document.querySelector<HTMLUListElement>("#offer-list");

  if (!button || !companyInput || !status || !list) {
    return;
  }

  const roleInput = document.querySelector<HTMLInputElement>("#offer-role");
  const queryLabel = document.querySelector<HTMLElement>("#offer-query");

  if (!roleInput || !queryLabel) {
    return;
  }

  roleInput.value = new URLSearchParams(window.location.search).get("title") || "";
  const refreshButton = document.querySelector<HTMLButtonElement>("#refresh-offers");
  const cacheLabel = document.querySelector<HTMLElement>("#offer-cache");

  if (!refreshButton || !cacheLabel) {
    return;
  }

  let version = 0;
  let nextBatch = 0;
  let busy = false;
  let expiresAt = 0;
  let cacheHit = false;
  const historyNote = document.querySelector<HTMLElement>("#offer-history-note");
  const resetButton = document.querySelector<HTMLButtonElement>("#reset-offer-history");
  let history = readOfferHistory();
  const seenPosts = new Set<string>(history.seen);

  const searchKey = (): string => {
    return JSON.stringify([companyInput.value.trim().toLowerCase(), roleInput.value.trim().toLowerCase()]);
  };

  const restoreCursor = (): void => {
    nextBatch = 0;
    const saved = history.cursors[searchKey()];

    if (Number.isInteger(saved) && saved >= 0 && saved <= 15) {
      nextBatch = saved;
    }
  };

  const saveHistory = (): void => {
    history.seen = Array.from(seenPosts);
    history.cursors[searchKey()] = nextBatch;

    try {
      localStorage.setItem(offerHistoryKey, JSON.stringify(history));

      if (historyNote) {
        historyNote.textContent = `${seenPosts.size} posts remembered in this browser.`;
      }
    } catch {
      if (historyNote) {
        historyNote.textContent = "Browser storage is unavailable. Seen posts will only be remembered while this page stays open.";
      }
    }
  };

  restoreCursor();
  button.disabled = nextBatch >= 15;
  refreshButton.disabled = false;
  saveHistory();

  const updateCacheLabel = (): void => {
    if (!expiresAt) {
      cacheLabel.textContent = "";
      return;
    }

    const seconds = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
    const minutes = Math.floor(seconds / 60);
    const remainder = String(seconds % 60).padStart(2, "0");
    let source = "Fetched fresh; now cached";

    if (cacheHit) {
      source = "Loaded from cache";
    }

    cacheLabel.textContent = `${source}. Cache expires in ${minutes}:${remainder}.`;

    if (seconds === 0) {
      cacheLabel.textContent = "Cache expired. Your next fresh search will fetch from the provider.";
    }
  };

  window.setInterval(updateCacheLabel, 1000);

  const clearOfferResults = (): void => {
    version += 1;
    nextBatch = 0;
    expiresAt = 0;
    restoreCursor();
    refreshButton.disabled = busy;
    button.textContent = "Find new posts";
    button.disabled = busy || nextBatch >= 15;
    updateCacheLabel();
    list.replaceChildren();
    list.hidden = true;
    queryLabel.textContent = "";
    status.textContent = "Ready to search.";
  }

  companyInput.addEventListener("input", clearOfferResults);
  roleInput.addEventListener("input", clearOfferResults);

  const searchOffers = async (forceRefresh: boolean): Promise<void> => {
    if (busy || !companyInput.reportValidity() || !roleInput.reportValidity()) {
      return;
    }

    let batch = nextBatch;

    if (forceRefresh) {
      batch = nextBatch;

      if (batch >= 15) {
        batch = 0;
      }
    }

    if (batch < 0 || batch >= 15) {
      return;
    }

    const submittedVersion = version;
    const employer = companyInput.value.trim();
    busy = true;
    button.disabled = true;
    refreshButton.disabled = true;
    queryLabel.textContent = "";
    status.textContent = "Finding posts...";

    try {
      const response = await fetch("/api/offer-posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company: employer, jobTitle: roleInput.value.trim(), batch, forceRefresh }),
        signal: AbortSignal.timeout(20000),
      });
      const data = await response.json();

      if (submittedVersion !== version) {
        return;
      }

      if (!response.ok) {
        throw new Error(data.error || "Couldn't search offer announcements.");
      }

      if (!Array.isArray(data.posts) || typeof data.query !== "string" || typeof data.cache?.remainingSeconds !== "number") {
        throw new Error("The server returned an unexpected response.");
      }

      nextBatch = batch + 1;
      expiresAt = Date.now() + data.cache.remainingSeconds * 1000;
      cacheHit = data.cache.hit === true;
      updateCacheLabel();
      queryLabel.textContent = `Batch ${batch + 1}, page ${data.page}: ${data.query}`;
      const previousCount = seenPosts.size;

      if (forceRefresh) {
        list.replaceChildren();
      }

      for (const post of data.posts) {
        if (!post || typeof post.title !== "string" || typeof post.url !== "string" || typeof post.snippet !== "string") {
          continue;
        }

        let url: URL;

        try {
          url = new URL(post.url);
        } catch {
          continue;
        }

        const activity = url.pathname.match(/(?:activity[:-])(\d+)/);
        let identity = url.pathname.replace(/\/$/, "").toLowerCase();

        if (activity) {
          identity = activity[1];
        }

        if (seenPosts.has(identity)) {
          continue;
        }
        const isLinkedIn = url.hostname === "linkedin.com" || url.hostname.endsWith(".linkedin.com");

        if (!isLinkedIn || url.protocol !== "https:" || url.username || url.password || url.port) {
          continue;
        }

        seenPosts.add(identity);
        const item = document.createElement("li");
        const link = document.createElement("a");
        const snippet = document.createElement("p");
        link.textContent = post.title;
        link.href = url.href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        snippet.textContent = post.snippet || "Open post to read more.";
        item.append(link, snippet);

        if (Array.isArray(post.contacts)) {
          for (const contact of post.contacts) {
            if (!contact || typeof contact.name !== "string" || typeof contact.evidence !== "string") {
              continue;
            }

            const name = document.createElement("strong");
            const evidence = document.createElement("p");
            name.textContent = `Possible recruiter: ${contact.name}`;
            evidence.textContent = `"${contact.evidence}" ? unverified.`;
            const details = document.createElement("details");
            const summary = document.createElement("summary");
            summary.textContent = "Why this name?";
            details.append(summary, evidence);
            item.append(name, details);
          }
        }

        list.append(item);
      }

      saveHistory();
      list.hidden = list.childElementCount === 0;

      const added = seenPosts.size - previousCount;
      status.textContent = `${added} new ? ${list.childElementCount} shown`;
      button.textContent = "Find new posts";

      if (added === 0) {
        status.textContent = "No new posts here. Try the next search.";
      }

      if (nextBatch >= 15) {
        status.textContent += " End of results. Refresh to check again.";
      }
    } catch (error) {
      if (submittedVersion !== version) {
        return;
      }

      status.textContent = "Couldn't search offer announcements. Please try again.";

      if (error instanceof Error) {
        status.textContent = error.message;
      }
    } finally {
      busy = false;
      button.disabled = nextBatch >= 15;
      refreshButton.disabled = false;
    }
  };

  resetButton?.addEventListener("click", () => {
    if (busy) {
      return;
    }

    history = { seen: [], cursors: {} };
    seenPosts.clear();
    clearOfferResults();
    saveHistory();
    status.textContent = "History reset. Older posts can appear again.";
  });

  button.addEventListener("click", () => {
    void searchOffers(false);
  });

  refreshButton.addEventListener("click", () => {
    void searchOffers(true);
  });
}

initializeOfferSearch();
