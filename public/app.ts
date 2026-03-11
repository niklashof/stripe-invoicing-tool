interface AuthUser {
  id: string;
  username: string;
}

interface SerializedAccount {
  slug: string;
  name: string;
  webhookPath: string;
  hasStripeKey: boolean;
  stripeSecretKeyMasked: string | null;
  hasWebhookSecret: boolean;
  stripeWebhookSecretMasked: string | null;
  hasSlackUrl: boolean;
  slackWebhookUrlMasked: string | null;
}

type AlertType = "error" | "success";

interface Window {
  api: typeof api;
  showAlert: typeof showAlert;
  checkAuth: typeof checkAuth;
  logout: typeof logout;
  downloadBlob: typeof downloadBlob;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has("Content-Type") && options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`/api${path}`, {
    ...options,
    headers,
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

function showAlert(container: HTMLElement, message: string, type: AlertType = "error"): void {
  const existing = container.querySelector(".alert");
  if (existing) {
    existing.remove();
  }

  const div = document.createElement("div");
  div.className = `alert alert-${type}`;
  div.textContent = message;
  container.prepend(div);
}

async function checkAuth(): Promise<AuthUser | null> {
  try {
    const data = await api<{ user: AuthUser }>("/me");
    return data.user;
  } catch {
    return null;
  }
}

async function logout(): Promise<void> {
  await api("/logout", { method: "POST" });
  window.location.href = "/login.html";
}

async function downloadBlob(path: string): Promise<void> {
  const response = await fetch(`/api${path}`);
  if (!response.ok) {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const data = (await response.json()) as { error?: string };
      throw new Error(data.error || `Request failed (${response.status})`);
    }
    throw new Error(`Request failed (${response.status})`);
  }

  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") || "";
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match ? match[1] : "download.csv";
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

window.api = api;
window.showAlert = showAlert;
window.checkAuth = checkAuth;
window.logout = logout;
window.downloadBlob = downloadBlob;
