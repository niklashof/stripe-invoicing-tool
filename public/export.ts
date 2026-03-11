(() => {
  function getElement<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`Missing required element: ${id}`);
    }
    return element as T;
  }

  function formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function setThisMonth(): void {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    getElement<HTMLInputElement>("from").value = formatDate(from);
    getElement<HTMLInputElement>("to").value = formatDate(now);
  }

  function setLastMonth(): void {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to = new Date(now.getFullYear(), now.getMonth(), 0);
    getElement<HTMLInputElement>("from").value = formatDate(from);
    getElement<HTMLInputElement>("to").value = formatDate(to);
  }

  async function init(): Promise<void> {
    const slug = new URLSearchParams(window.location.search).get("slug");
    const exportCard = getElement<HTMLDivElement>("export-card");

    const user = await checkAuth();
    if (!user) {
      window.location.href = "/login.html";
      return;
    }
    if (!slug) {
      showAlert(exportCard, "Missing account slug");
      return;
    }

    try {
      const account = await api<SerializedAccount>(`/accounts/${slug}`);
      getElement<HTMLHeadingElement>("page-title").textContent = `Export Line Items - ${account.name}`;
      getElement<HTMLDivElement>("account-hint").textContent = `Exporting line items for ${
        account.name
      } (${account.slug}).`;
      setThisMonth();
    } catch (error) {
      showAlert(exportCard, getErrorMessage(error));
    }

    getElement<HTMLButtonElement>("preset-this-month").addEventListener("click", setThisMonth);
    getElement<HTMLButtonElement>("preset-last-month").addEventListener("click", setLastMonth);

    getElement<HTMLFormElement>("export-form").addEventListener("submit", async (event) => {
      event.preventDefault();

      const from = getElement<HTMLInputElement>("from").value;
      const to = getElement<HTMLInputElement>("to").value;
      if (!from || !to) {
        showAlert(exportCard, "Choose both dates before exporting.");
        return;
      }
      if (from > to) {
        showAlert(exportCard, '"From" must be on or before "To".');
        return;
      }

      try {
        await downloadBlob(
          `/accounts/${encodeURIComponent(slug)}/exports/line-items.csv?from=${encodeURIComponent(
            from
          )}&to=${encodeURIComponent(to)}`
        );
      } catch (error) {
        showAlert(exportCard, getErrorMessage(error));
      }
    });
  }

  void init();
})();
