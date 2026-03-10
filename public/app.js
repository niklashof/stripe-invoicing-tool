/**
 * Shared client-side utilities for the admin GUI.
 */

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

function showAlert(container, message, type = "error") {
  const existing = container.querySelector(".alert");
  if (existing) existing.remove();
  const div = document.createElement("div");
  div.className = `alert alert-${type}`;
  div.textContent = message;
  container.prepend(div);
}

async function checkAuth() {
  try {
    const data = await api("/me");
    return data.user;
  } catch {
    return null;
  }
}

async function logout() {
  await api("/logout", { method: "POST" });
  window.location.href = "/login.html";
}
