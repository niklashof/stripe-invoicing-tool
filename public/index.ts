(() => {
  function getElement<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`Missing required element: ${id}`);
    }
    return element as T;
  }

  function esc(value: string): string {
    const div = document.createElement("div");
    div.textContent = value;
    return div.innerHTML;
  }

  async function loadAccounts(): Promise<void> {
    const list = getElement<HTMLUListElement>("account-list");
    try {
      const accounts = await api<SerializedAccount[]>("/accounts");
      if (accounts.length === 0) {
        list.innerHTML = '<li class="empty-state">No accounts configured yet. Add one to get started.</li>';
        return;
      }

      list.innerHTML = accounts
        .map(
          (account) => `
            <li class="account-item">
              <div class="account-info">
                <div class="account-name">${esc(account.name)}</div>
                <div class="account-slug">/webhook/${esc(account.slug)}</div>
                <div class="account-status">
                  <span class="badge ${account.hasStripeKey ? "badge-ok" : "badge-missing"}">${
                    account.hasStripeKey ? "Stripe Key" : "No Key"
                  }</span>
                  <span class="badge ${account.hasWebhookSecret ? "badge-ok" : "badge-missing"}">${
                    account.hasWebhookSecret ? "Webhook Secret" : "No Secret"
                  }</span>
                  <span class="badge ${account.hasSlackUrl ? "badge-ok" : "badge-missing"}">${
                    account.hasSlackUrl ? "Slack" : "No Slack"
                  }</span>
                </div>
              </div>
              <div class="account-actions">
                <a href="/export.html?slug=${esc(account.slug)}" class="btn btn-secondary">Export</a>
                <a href="/account-form.html?slug=${esc(account.slug)}" class="btn btn-secondary">Edit</a>
                <button class="btn btn-danger" data-delete-slug="${esc(account.slug)}">Delete</button>
              </div>
            </li>
          `
        )
        .join("");

      list.querySelectorAll<HTMLButtonElement>("[data-delete-slug]").forEach((button) => {
        button.addEventListener("click", async () => {
          const slug = button.dataset.deleteSlug;
          if (!slug) {
            return;
          }
          if (!window.confirm(`Delete account "${slug}"? This cannot be undone.`)) {
            return;
          }

          try {
            await api(`/accounts/${slug}`, { method: "DELETE" });
            await loadAccounts();
          } catch (error) {
            window.alert(getErrorMessage(error));
          }
        });
      });
    } catch (error) {
      list.innerHTML = `<li class="empty-state" style="color:#c74b43;">Error: ${esc(
        getErrorMessage(error)
      )}</li>`;
    }
  }

  async function init(): Promise<void> {
    const user = await checkAuth();
    if (!user) {
      window.location.href = "/login.html";
      return;
    }

    getElement<HTMLSpanElement>("nav-user").textContent = user.username;
    getElement<HTMLButtonElement>("logout-button").addEventListener("click", () => {
      void logout();
    });

    await loadAccounts();
  }

  void init();
})();
