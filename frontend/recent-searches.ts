async function loadRecentSearches(): Promise<void> {
  const list = document.querySelector<HTMLUListElement>("#history-list");
  const status = document.querySelector<HTMLElement>("#history-status");

  if (!list || !status) {
    return;
  }

  // Ignore older requests if a new search is saved while history is loading.
  const requestVersion = ++historyRequestVersion;
  status.textContent = "Loading saved searches...";

  try {
    const response = await fetch("/api/recent-searches", {
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    const data = await response.json();

    if (requestVersion !== historyRequestVersion) {
      return;
    }

    if (!response.ok || !Array.isArray(data.searches)) {
      throw new Error(data.error || "Couldn't load saved searches.");
    }

    list.replaceChildren();

    for (const search of data.searches) {
      if (!search || typeof search.title !== "string" || typeof search.company !== "string" || typeof search.created_at !== "string") {
        continue;
      }

      const item = document.createElement("li");
      const heading = document.createElement("strong");
      const date = document.createElement("span");
      heading.textContent = `${search.title} — ${search.company || "Company not listed"}`;
      date.textContent = new Date(search.created_at).toLocaleString();
      item.append(heading, date);
      list.append(item);
    }

    status.textContent = "Latest saved searches from the database.";

    if (!list.childElementCount) {
      status.textContent = "No saved searches yet. Try a sample job above.";
    }
  } catch (error) {
    if (requestVersion !== historyRequestVersion) {
      return;
    }

    list.replaceChildren();
    status.textContent = "Couldn't load saved searches. Please try again.";

    if (error instanceof Error) {
      status.textContent = error.message;
    }
  }
}

let historyRequestVersion = 0;
document.querySelector("#refresh-history")?.addEventListener("click", loadRecentSearches);
document.addEventListener("search-saved", loadRecentSearches);
void loadRecentSearches();
