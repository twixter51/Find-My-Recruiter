const form = document.querySelector<HTMLFormElement>("#job-form");
const jobInput = document.querySelector<HTMLInputElement>("#job-url");
const statusMessage = document.querySelector<HTMLParagraphElement>("#search-status");
interface JobDetails {
  title: string;
  company: string;
  locations: string[];
  team: string;
  description: string;
  sourceUrl: string;
  warnings: string[];
}

let inputVersion = 0;

document.querySelectorAll<HTMLButtonElement>("[data-sample-action]").forEach((button) => {
  button.addEventListener("click", async () => {
    const link = button.closest("li")?.querySelector<HTMLAnchorElement>("a");
    const feedback = document.querySelector<HTMLElement>("#sample-status");

    if (!link || !jobInput || !feedback) {
      return;
    }

    if (button.dataset.sampleAction === "copy") {
      try {
        await navigator.clipboard.writeText(link.href);
        feedback.textContent = "Job link copied.";
        return;
      } catch {
        feedback.textContent = "Copy isn't available. The link is selected in the form so you can copy it manually.";
      }
    } else {
      feedback.textContent = "Sample ready. Select Read job posting to try it.";
    }

    jobInput.value = link.href;
    jobInput.dispatchEvent(new Event("input", { bubbles: true }));
    jobInput.focus();
    jobInput.select();
  });
});

if (!form || !jobInput || !statusMessage) {
  throw new Error("The job search form is missing required elements.");
}

// Clear old feedback when the user changes the link.
jobInput.addEventListener("input", () => {
  inputVersion += 1;
  jobInput.setCustomValidity("");
  statusMessage.textContent = "";
});

form.addEventListener("submit", async (event) => {
  // Keep the browser on this page instead of submitting and reloading it.
  event.preventDefault();

  const value = jobInput.value.trim();
  let jobUrl: URL;

  try {
    jobUrl = new URL(value);

    if (jobUrl.protocol !== "https:" && jobUrl.protocol !== "http:") {
      throw new Error("Only web links are supported.");
    }
  } catch {
    statusMessage.textContent = "";
    jobInput.setCustomValidity(
      "Enter a complete job URL starting with https:// or http://."
    );
    jobInput.reportValidity();
    return;
  }

  const button = form.querySelector<HTMLButtonElement>(
    'button[type="submit"]'
  );

  if (button?.disabled) {
    return;
  }

  if (button) {
    button.disabled = true;
  }

  const submittedVersion = inputVersion;

  statusMessage.textContent = "Reading job posting...";

  try {
    const response = await fetch("/api/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jobUrl: jobUrl.href,
      }),
      signal: AbortSignal.timeout(30000),
    });

    const data: {
      message?: string;
      error?: string;
      job?: JobDetails;
      saved?: boolean;
      recruiterSearch?: { company: string; team: string };
    } = await response.json();

    if (data.saved) {
      document.dispatchEvent(new Event("search-saved"));
    }

    if (submittedVersion !== inputVersion) {
      return;
    }

    if (!response.ok) {
      throw new Error(
        data.error || "The server couldn't accept this link."
      );
    }

    if (!data.job) {
      throw new Error("The server didn't return job details. Please try another posting.");
    }

    const parameters = new URLSearchParams({
      title: data.job.title,
      company: data.recruiterSearch?.company ?? data.job.company,
      team: data.recruiterSearch?.team ?? data.job.team,
    });

    if (data.job.warnings.length) {
      parameters.set("notice", data.job.warnings.join(" "));
    }

    window.location.assign(`recruiters.html?${parameters.toString()}`);
  } catch (error) {
    if (submittedVersion !== inputVersion) {
      return;
    }

    if (error instanceof TypeError) {
      statusMessage.textContent =
        "Couldn't reach the server. Start it with npm start and open http://localhost:3000.";
    } else if (error instanceof Error) {
      statusMessage.textContent = error.message;
    } else {
      statusMessage.textContent = "Something went wrong. Please try again.";
    }
  } finally {
    if (button) {
      button.disabled = false;
    }
  }
});

