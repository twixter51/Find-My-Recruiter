function initializeAuth(): void {
  const form = document.querySelector<HTMLFormElement>("#auth-form");
  const email = document.querySelector<HTMLInputElement>("#email");
  const password = document.querySelector<HTMLInputElement>("#password");
  const button = document.querySelector<HTMLButtonElement>("#auth-submit");
  const toggle = document.querySelector<HTMLButtonElement>("#auth-switch");
  const heading = document.querySelector<HTMLElement>("#auth-heading");
  const message = document.querySelector<HTMLElement>("#auth-message");

  if (!form || !email || !password || !button || !toggle || !heading || !message) {
    return;
  }

  // Keep only a public job URL, never credentials, in this return path.
  const jobUrl = new URLSearchParams(location.search).get("jobUrl");
  const preview = document.querySelector<HTMLElement>("#locked-preview");

  if (preview && jobUrl) {
    preview.hidden = false;
  }

  if (!jobUrl) {
    const consent = document.querySelector<HTMLElement>("#credit-consent");

    if (consent) {
      consent.textContent = "Each recruiter page or offer-post batch costs 1 credit, including refreshes.";
    }
  }

  let signup = true;
  const showMode = (): void => {
    if (signup) {
      heading.textContent = "Create your account";
      button.textContent = "Sign up";
      toggle.textContent = "Already have an account? Log in";
      password.autocomplete = "new-password";
    } else {
      heading.textContent = "Log in to Find My Rec";
      button.textContent = "Log in";
      toggle.textContent = "New here? Sign up";
      password.autocomplete = "current-password";
    }
  };

  toggle.addEventListener("click", () => {
    signup = !signup;
    message.textContent = "";
    showMode();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    button.disabled = true;
    toggle.disabled = true;
    message.textContent = "Please wait...";
    let endpoint = "/api/auth/login";

    if (signup) {
      endpoint = "/api/auth/signup";
    }

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.value.trim(), password: password.value }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Unable to continue.");
      }

      password.value = "";

      if (signup) {
        message.textContent = data.message;
        signup = false;
        showMode();
        return;
      }

      if (jobUrl) {
        const parameters = new URLSearchParams({ jobUrl, resume: "1" });
        window.location.assign(`index.html?${parameters}`);
      } else {
        window.location.assign("index.html");
      }
    } catch (error) {
      message.textContent = "Unable to connect. Please try again.";

      if (error instanceof Error) {
        message.textContent = error.message;
      }
    } finally {
      button.disabled = false;
      toggle.disabled = false;
    }
  });
}

initializeAuth();
