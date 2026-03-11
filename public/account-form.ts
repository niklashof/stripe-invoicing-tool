(() => {
  type SecretFieldType = "stripe" | "webhook" | "slack";

  function getElement<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`Missing required element: ${id}`);
    }
    return element as T;
  }

  function showWebhookUrl(slug: string): void {
    const info = getElement<HTMLDivElement>("webhook-info");
    const url = getElement<HTMLDivElement>("webhook-url");
    url.textContent = `${window.location.origin}/webhook/${slug}`;
    info.style.display = "block";
  }

  function syncClearState(entry: { input: HTMLInputElement; clear: HTMLInputElement }): void {
    if (entry.clear.checked) {
      entry.input.value = "";
    }
    entry.input.disabled = entry.clear.checked;
  }

  function updateStoredSecretState(
    type: SecretFieldType,
    hasValue: boolean,
    maskedValue: string | null
  ): void {
    const entries = {
      stripe: {
        hint: getElement<HTMLDivElement>("stripe-key-hint"),
        row: getElement<HTMLLabelElement>("clear-stripe-key-row"),
        input: getElement<HTMLInputElement>("stripeSecretKey"),
        clear: getElement<HTMLInputElement>("clearStripeSecretKey"),
      },
      webhook: {
        hint: getElement<HTMLDivElement>("webhook-secret-hint"),
        row: getElement<HTMLLabelElement>("clear-webhook-secret-row"),
        input: getElement<HTMLInputElement>("stripeWebhookSecret"),
        clear: getElement<HTMLInputElement>("clearStripeWebhookSecret"),
      },
      slack: {
        hint: getElement<HTMLDivElement>("slack-url-hint"),
        row: getElement<HTMLLabelElement>("clear-slack-url-row"),
        input: getElement<HTMLInputElement>("slackWebhookUrl"),
        clear: getElement<HTMLInputElement>("clearSlackWebhookUrl"),
      },
    } satisfies Record<
      SecretFieldType,
      {
        hint: HTMLElement;
        row: HTMLElement;
        input: HTMLInputElement;
        clear: HTMLInputElement;
      }
    >;

    const entry = entries[type];
    if (!hasValue) {
      entry.row.style.display = "none";
      return;
    }

    entry.hint.textContent = `Stored value: ${
      maskedValue || "Stored"
    }. Leave blank to keep it, or enter a new value to replace it.`;
    entry.row.style.display = "block";
    entry.input.placeholder = "Leave blank to keep existing value";
    entry.input.addEventListener("input", () => {
      if (entry.input.value.trim()) {
        entry.clear.checked = false;
      }
      syncClearState(entry);
    });
    entry.clear.addEventListener("change", () => syncClearState(entry));
  }

  async function init(): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    const editSlug = params.get("slug");
    const isEdit = Boolean(editSlug);

    const user = await checkAuth();
    if (!user) {
      window.location.href = "/login.html";
      return;
    }

    const formCard = getElement<HTMLDivElement>("form-card");
    const pageTitle = getElement<HTMLHeadingElement>("page-title");
    const submitButton = getElement<HTMLButtonElement>("submit-btn");
    const slugInput = getElement<HTMLInputElement>("slug");
    const exportLink = getElement<HTMLAnchorElement>("export-link");

    if (isEdit && editSlug) {
      pageTitle.textContent = "Edit Account";
      submitButton.textContent = "Save Changes";
      slugInput.readOnly = true;
      slugInput.style.background = "#f0f0f0";

      try {
        const account = await api<SerializedAccount>(`/accounts/${editSlug}`);
        slugInput.value = account.slug;
        getElement<HTMLInputElement>("name").value = account.name || "";
        updateStoredSecretState("stripe", account.hasStripeKey, account.stripeSecretKeyMasked);
        updateStoredSecretState("webhook", account.hasWebhookSecret, account.stripeWebhookSecretMasked);
        updateStoredSecretState("slack", account.hasSlackUrl, account.slackWebhookUrlMasked);
        showWebhookUrl(account.slug);
        exportLink.href = `/export.html?slug=${encodeURIComponent(account.slug)}`;
        exportLink.style.display = "inline-flex";
      } catch (error) {
        showAlert(formCard, getErrorMessage(error));
      }
    }

    slugInput.addEventListener("input", (event) => {
      const target = event.currentTarget as HTMLInputElement;
      const value = target.value.trim();
      if (value && /^[a-z0-9][a-z0-9-]*$/.test(value)) {
        showWebhookUrl(value);
      } else {
        getElement<HTMLDivElement>("webhook-info").style.display = "none";
      }
    });

    getElement<HTMLFormElement>("account-form").addEventListener("submit", async (event) => {
      event.preventDefault();

      const body = {
        slug: slugInput.value.trim(),
        name: getElement<HTMLInputElement>("name").value.trim(),
        stripeSecretKey: getElement<HTMLInputElement>("clearStripeSecretKey").checked
          ? ""
          : getElement<HTMLInputElement>("stripeSecretKey").value.trim(),
        stripeWebhookSecret: getElement<HTMLInputElement>("clearStripeWebhookSecret").checked
          ? ""
          : getElement<HTMLInputElement>("stripeWebhookSecret").value.trim(),
        slackWebhookUrl: getElement<HTMLInputElement>("clearSlackWebhookUrl").checked
          ? ""
          : getElement<HTMLInputElement>("slackWebhookUrl").value.trim(),
        clearStripeSecretKey: getElement<HTMLInputElement>("clearStripeSecretKey").checked,
        clearStripeWebhookSecret: getElement<HTMLInputElement>("clearStripeWebhookSecret").checked,
        clearSlackWebhookUrl: getElement<HTMLInputElement>("clearSlackWebhookUrl").checked,
      };

      try {
        if (isEdit && editSlug) {
          await api(`/accounts/${editSlug}`, { method: "PUT", body: JSON.stringify(body) });
        } else {
          await api("/accounts", { method: "POST", body: JSON.stringify(body) });
        }
        window.location.href = "/";
      } catch (error) {
        showAlert(formCard, getErrorMessage(error));
      }
    });
  }

  void init();
})();
