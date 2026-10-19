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
  let version = 0;

  const clearOfferResults = (): void => {
    version += 1;
    list.replaceChildren();
    list.hidden = true;
    queryLabel.textContent = "";
    status.textContent = "Search again to use the updated company and role.";
  }

  companyInput.addEventListener("input", clearOfferResults);
  roleInput.addEventListener("input", clearOfferResults);

  button.addEventListener("click", async () => {
    if (button.disabled || !companyInput.reportValidity()) {
      return;
    }

    const submittedVersion = version;
    const employer = companyInput.value.trim();
    button.disabled = true;
    list.replaceChildren();
    list.hidden = true;
    queryLabel.textContent = "";
    status.textContent = "Searching offer announcements...";

    try {
      const response = await fetch("/api/offer-posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company: employer, jobTitle: roleInput.value.trim() }),
        signal: AbortSignal.timeout(20000),
      });
      const data = await response.json();

      if (submittedVersion !== version) {
        return;
      }

      if (!response.ok) {
        throw new Error(data.error || "Couldn't search offer announcements.");
      }

      if (!Array.isArray(data.posts)) {
        throw new Error("The server returned an unexpected response.");
      }

      queryLabel.textContent = `Search used: ${data.query}`;

      for (const post of data.posts) {
        if (!post || typeof post.title !== "string" || typeof post.url !== "string" || typeof post.snippet !== "string") {
          continue;
        }

        const url = new URL(post.url);
        const isLinkedIn = url.hostname === "linkedin.com" || url.hostname.endsWith(".linkedin.com");

        if (!isLinkedIn || url.protocol !== "https:" || url.username || url.password || url.port) {
          continue;
        }

        const item = document.createElement("li");
        const link = document.createElement("a");
        const snippet = document.createElement("p");
        link.textContent = post.title;
        link.href = url.href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        snippet.textContent = post.snippet || "Open this announcement to look for recruiting acknowledgments.";
        item.append(link, snippet);

        if (typeof post.mentionedName === "string" && post.mentionedName) {
          const name = document.createElement("p");
          const lookup = document.createElement("a");
          const parameters = new URLSearchParams({ company: employer, team: post.mentionedName });
          name.textContent = `Possible contact mentioned: ${post.mentionedName} (unverified)`;
          lookup.textContent = "Find this person's recruiter profile";
          lookup.href = `recruiters.html?${parameters.toString()}`;
          lookup.target = "_blank";
          lookup.rel = "noopener noreferrer";
          item.append(name, lookup);
        }

        list.append(item);
      }

      list.hidden = list.childElementCount === 0;

      if (list.hidden) {
        status.textContent = "No matching offer announcements found. Try a shorter role title, or leave the role blank to broaden the search.";
      } else {
        status.textContent = `${list.childElementCount} possible offer announcements. Check each post to confirm its context.`;
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
      button.disabled = false;
    }
  });
}

initializeOfferSearch();
