(() => {
  function getElement<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`Missing required element: ${id}`);
    }
    return element as T;
  }

  let isSetup = false;

  async function init(): Promise<void> {
    const user = await checkAuth();
    if (user) {
      window.location.href = "/";
      return;
    }

    const response = await api<{ needed: boolean; disabled: boolean }>("/setup-needed");
    if (response.needed) {
      isSetup = true;
      getElement<HTMLHeadingElement>("form-title").textContent = "Create Admin Account";
      getElement<HTMLButtonElement>("submit-btn").textContent = "Create Account";
      getElement<HTMLInputElement>("password").autocomplete = "new-password";
    } else if (response.disabled) {
      const note = getElement<HTMLParagraphElement>("setup-note");
      note.textContent = "Initial setup is disabled in the web UI. Create the first user via CLI.";
      note.style.display = "block";
    }

    getElement<HTMLFormElement>("auth-form").addEventListener("submit", async (event) => {
      event.preventDefault();

      const card = getElement<HTMLDivElement>("login-card");
      const username = getElement<HTMLInputElement>("username").value;
      const password = getElement<HTMLInputElement>("password").value;

      try {
        const endpoint = isSetup ? "/setup" : "/login";
        await api(endpoint, {
          method: "POST",
          body: JSON.stringify({ username, password }),
        });
        window.location.href = "/";
      } catch (error) {
        showAlert(card, getErrorMessage(error));
      }
    });
  }

  void init();
})();
