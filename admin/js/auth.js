// Authentication helpers — login, logout, session token storage.
//
// The session token is an HMAC-signed string from Apps Script.
// We store it in localStorage with its expiry time so we can:
//   - Avoid sending an obviously-expired token on every request.
//   - Redirect to login.html on a 401 from the API.

const TOKEN_KEY = "ft.session_token";
const TOKEN_EXPIRY_KEY = "ft.session_expires_at";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) ?? null;
}

export function getTokenExpiry() {
  const raw = localStorage.getItem(TOKEN_EXPIRY_KEY);
  return raw ? new Date(raw).getTime() : 0;
}

export function hasValidSession() {
  return Boolean(getToken()) && getTokenExpiry() > Date.now();
}

export function setSession(token, expiresAt) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(TOKEN_EXPIRY_KEY, expiresAt);
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_EXPIRY_KEY);
}

// Redirects to login if no valid session. Call from every page that needs auth.
export function requireSession() {
  if (!hasValidSession()) {
    location.replace("login.html");
    return false;
  }
  return true;
}

// Hook for the "Sign out" link on every page.
export function wireLogoutLink(linkId = "logout-link") {
  const el = document.getElementById(linkId);
  if (!el) return;
  el.addEventListener("click", async (e) => {
    e.preventDefault();
    // Best-effort logout — even if it fails, we still clear locally.
    try {
      const { api } = await import("./api.js");
      await api("logout").catch(() => {});
    } catch {}
    clearSession();
    location.replace("login.html");
  });
}
