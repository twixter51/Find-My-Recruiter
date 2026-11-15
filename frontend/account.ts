let accountUserId = "";
// The browser only displays the balance. The backend owns authorization/credits.
async function updateAccount(): Promise<boolean> {
  const label = document.querySelector<HTMLElement>("#account-status");
  const logout = document.querySelector<HTMLButtonElement>("#logout");
  const response = await fetch("/api/auth/me", { cache: "no-store" });

  if (response.status === 401 || response.status === 403) {
    if (label) {
      label.textContent = "Log in / Sign up";
      label.classList.remove("credits-empty");
      label.setAttribute("href", "auth.html");
    }

    if (logout) {
      logout.hidden = true;
    }

    accountUserId = "";
    return false;
  }

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Could not load your account.");
  }

  accountUserId = data.id;

  if (label) {
    label.textContent = `${data.credits} search credits`;

    if (data.unlimited === true) {
      label.textContent = "Unlimited credits";
      label.classList.add("credits-unlimited");
    }

    label.classList.toggle("credits-empty", data.unlimited !== true && data.credits === 0);
    label.removeAttribute("href");
  }

  if (logout) {
    logout.hidden = false;
  }

  return true;
}

// A transport retry reuses the same ID. A fresh user action gets a new ID.
async function creditSearch(url: string, body: Record<string, unknown>): Promise<Response> {
  const requestId = crypto.randomUUID();
  const options = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, requestId }),
  };

  try {
    return await fetch(url, { ...options, signal: AbortSignal.timeout(45000) });
  } catch {
    return fetch(url, { ...options, signal: AbortSignal.timeout(45000) });
  }
}

async function initializeAccount(): Promise<void> {
  try {
    await updateAccount();
  } catch {
    const label = document.querySelector<HTMLElement>("#account-status");

    if (label) {
      label.textContent = "Account unavailable";
      label.classList.remove("credits-empty");
    }
  }

  document.querySelector("#logout")?.addEventListener("click", async () => {
    const response = await fetch("/api/auth/logout", { method: "POST" });

    if (response.ok) {
      window.location.assign("index.html");
    }
  });
}

void initializeAccount();
