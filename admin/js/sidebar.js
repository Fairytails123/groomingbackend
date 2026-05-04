// Sidebar helpers — populates the count chips and the user identity block
// that every admin page renders in `<aside class="sb">`.
//
// Pages call `populateSidebarCounts()` once at boot. The summary fetch is
// shared across calls within a single page load via a module-level promise,
// so a page that imports both this and dashboard.js doesn't double-fetch.

import { api } from "./api.js";

let summaryPromise = null;

export function fetchDashboardSummary() {
  if (!summaryPromise) {
    summaryPromise = api("dashboard_summary").catch(() => null);
  }
  return summaryPromise;
}

export async function populateSidebarCounts() {
  applyUserIdentity();
  const data = await fetchDashboardSummary();
  if (!data) return;
  applySidebarCounts(data.counts ?? {});
}

export function applySidebarCounts(counts) {
  const set = (key, value) => {
    for (const el of document.querySelectorAll(`[data-sb-count="${key}"]`)) {
      el.textContent = value > 0 ? String(value) : "";
    }
  };
  set("breeds", Number(counts.breeds ?? 0));
  set("review", Number(counts.needs_review ?? 0));
  set("publish", Number(counts.ready_to_publish ?? 0));
}

function applyUserIdentity() {
  // Single-editor model — no user table, just Kamal. Set decorative
  // name/initials in the sidebar avatar so it doesn't read "Signed in" / "·".
  const nameEl = document.getElementById("user-name");
  const initialsEl = document.getElementById("user-initials");
  if (nameEl && nameEl.textContent.trim() === "Signed in") nameEl.textContent = "Kamal";
  if (initialsEl && initialsEl.textContent.trim() === "·") initialsEl.textContent = "K";
}
