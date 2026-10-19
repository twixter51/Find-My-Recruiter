// This page calls our backend. The Serper key stays on the server.
interface Recruiter {
  name: string;
  linkedinUrl: string;
}

function showRecruiterResults(recruiters: Recruiter[]): void {
  const list = document.querySelector<HTMLUListElement>("#recruiter-list");
  const status = document.querySelector<HTMLParagraphElement>("#recruiter-status");

  if (!list || !status) {
    throw new Error("The recruiter results elements are missing.");
  }

  list.replaceChildren();

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

  if (list.hidden) {
    status.textContent = "No recruiter profiles found for this job.";
  } else {
    status.textContent = `${list.childElementCount} potential contacts`;
  }
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
  let searchVersion = 0;

  searchForm.addEventListener("input", () => {
    searchVersion += 1;
    list.hidden = true;
    queryLabel.textContent = "";
    searchStatus.textContent = "Search again to use the updated details.";
  });

  searchForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (button.disabled) {
      return;
    }

    const submittedVersion = searchVersion;
    button.disabled = true;
    list.replaceChildren();
    list.hidden = true;
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

      queryLabel.textContent = `Search used: ${data.query}`;
      showRecruiterResults(profiles);
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
      button.disabled = false;
    }
  });
}

initializeRecruiterPage();
