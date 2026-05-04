// Home (dashboard) page — stat tiles, today's prep, oldest drafts,
// recently updated, quick-add. Populated from `dashboard_summary` plus
// `dashboard_today_prep`. Sidebar counts are populated by sidebar.js.

import { requireSession, wireLogoutLink } from "../auth.js";
import { api, ApiError } from "../api.js";
import { formatRelativeTime, formatDate } from "../format.js";
import { formDialog, toastError, toastSuccess } from "../ui.js";
import { fetchDashboardSummary, applySidebarCounts, populateSidebarCounts } from "../sidebar.js";

if (!requireSession()) throw new Error("redirecting to login");
wireLogoutLink();
populateSidebarCounts();

const greetingEl   = document.getElementById("home-greeting");
const metaEl       = document.getElementById("home-meta");
const todayCard    = document.getElementById("today-card");
const todayListEl  = document.getElementById("today-list");
const oldestEl     = document.getElementById("oldest-drafts");
const recentEl     = document.getElementById("recently-updated");

if (greetingEl) greetingEl.textContent = "Welcome back, Kamal";
if (metaEl)     metaEl.textContent     = `Today, ${formatDate(new Date().toISOString())}`;

wireQuickAdd();

(async () => {
  await Promise.all([
    loadSummary(),
    loadTodayPrep(),
  ]);
})();

async function loadSummary() {
  const data = await fetchDashboardSummary();
  if (!data) {
    setStat("live-cards", "—");
    setStat("needs-review", "—");
    setStat("ready-to-publish", "—");
    setStat("drafts", "—");
    oldestEl.innerHTML = `<div style="padding:24px 20px; color:var(--color-secondary); text-align:center; font-size:13px;">Couldn't load drafts.</div>`;
    recentEl.innerHTML = `<div style="color:var(--color-secondary); font-size:13px;">Couldn't load recent updates.</div>`;
    return;
  }
  const counts = data.counts ?? {};
  setStat("live-cards",       counts.published ?? 0);
  setStat("needs-review",     counts.needs_review ?? 0);
  setStat("ready-to-publish", counts.ready_to_publish ?? 0);
  setStat("drafts",           counts.drafts ?? 0);
  applySidebarCounts(counts);

  renderOldestDrafts(data.oldest_drafts ?? []);
  renderRecentlyUpdated(data.recently_updated ?? []);
}

async function loadTodayPrep() {
  if (!todayCard) return;
  try {
    const data = await api("dashboard_today_prep").catch(() => ({ breeds: [] }));
    const breeds = data.breeds ?? [];
    if (breeds.length === 0) {
      todayCard.hidden = true;
      return;
    }
    todayCard.hidden = false;
    todayListEl.innerHTML = "";
    for (const b of breeds) {
      const row = document.createElement("a");
      row.className = "today__row";
      row.href = b.profile_id
        ? `profile.html?profile_id=${encodeURIComponent(b.profile_id)}`
        : `upload.html?breed_name=${encodeURIComponent(b.breed_name)}`;
      const initial = (b.breed_name ?? "?").trim().charAt(0).toUpperCase();
      const statusLabel =
        b.kb_status === "published" ? "Published" :
        b.kb_status === "draft"     ? "Draft" :
        "Not in system";
      row.innerHTML = `
        <div class="today__time">${b.appointment_time ? escapeHtml(b.appointment_time) : "—"}</div>
        <div class="today__avatar">${escapeHtml(initial)}</div>
        <div class="today__body">
          <div class="today__name">${escapeHtml(b.breed_name)}</div>
          <div class="today__sub">${escapeHtml(statusLabel)}</div>
        </div>`;
      todayListEl.appendChild(row);
    }
  } catch {
    todayCard.hidden = true;
  }
}

function renderOldestDrafts(items) {
  if (!oldestEl) return;
  oldestEl.innerHTML = "";
  if (items.length === 0) return;
  for (const d of items) {
    const row = document.createElement("a");
    row.className = "blog__row";
    row.href = `profile.html?profile_id=${encodeURIComponent(d.profile_id)}`;
    row.innerHTML = `
      <span class="blog__dot"></span>
      <span class="blog__name">${escapeHtml(d.breed_name)} <span style="color:var(--color-secondary); font-weight:500;">/ ${escapeHtml(d.groom_type)}</span></span>
      <span class="blog__age">${escapeHtml(formatRelativeTime(d.updated_at))}</span>`;
    oldestEl.appendChild(row);
  }
}

function renderRecentlyUpdated(items) {
  if (!recentEl) return;
  recentEl.innerHTML = "";
  if (items.length === 0) return;
  for (const item of items) {
    const row = document.createElement("a");
    row.href = `profile.html?profile_id=${encodeURIComponent(item.profile_id)}`;
    row.style.display = "flex";
    row.style.justifyContent = "space-between";
    row.style.alignItems = "center";
    row.style.gap = "12px";
    row.style.padding = "10px 0";
    row.style.borderBottom = "1px solid var(--color-border)";
    row.innerHTML = `
      <div style="min-width:0;">
        <div style="font-size:13.5px; font-weight:600; color:var(--color-ink); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(item.breed_name)} <span style="color:var(--color-secondary); font-weight:500;">/ ${escapeHtml(item.groom_type)}</span></div>
        <div style="font-size:12px; color:var(--color-secondary); margin-top:2px;">${escapeHtml(prettyStatus(item.status))}</div>
      </div>
      <span style="font-size:11.5px; color:var(--color-secondary); flex-shrink:0;">${escapeHtml(formatRelativeTime(item.updated_at))}</span>`;
    recentEl.appendChild(row);
  }
  // Strip the bottom border of the last row.
  const last = recentEl.lastElementChild;
  if (last) last.style.borderBottom = "0";
}

function prettyStatus(s) {
  if (s === "Needs Review") return "Needs review";
  return s ?? "";
}

function setStat(key, value) {
  const el = document.querySelector(`[data-stat="${key}"]`);
  if (el) el.textContent = String(value);
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Quick add ──────────────────────────────────────────────────────
//
// New home page has just an input (#home-quick-find) — no results
// container in the markup. We inject a floating dropdown styled with
// inline rules so the redesigned CSS doesn't have to grow.

function wireQuickAdd() {
  const input = document.getElementById("home-quick-find");
  if (!input) return;
  const wrapper = input.closest(".quickadd__input") ?? input.parentElement;
  if (!wrapper) return;
  // Make the wrapper a positioning context for the floating panel.
  if (getComputedStyle(wrapper).position === "static") {
    wrapper.style.position = "relative";
  }

  const panel = document.createElement("div");
  panel.className = "card";
  panel.hidden = true;
  Object.assign(panel.style, {
    position: "absolute",
    top: "calc(100% + 6px)",
    left: "0",
    right: "0",
    zIndex: "20",
    padding: "6px 0",
    maxHeight: "320px",
    overflowY: "auto",
  });
  wrapper.appendChild(panel);

  let debounceTimer = null;
  let lastQuery = "";

  input.addEventListener("input", () => {
    const q = input.value.trim();
    if (debounceTimer) clearTimeout(debounceTimer);
    if (!q) { hidePanel(); return; }
    debounceTimer = setTimeout(() => runSearch(q), 200);
  });

  input.addEventListener("focus", () => {
    if (input.value.trim()) runSearch(input.value.trim());
  });

  document.addEventListener("click", (e) => {
    if (!wrapper.contains(e.target)) hidePanel();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { hidePanel(); input.blur(); }
    if (e.key === "Enter") {
      e.preventDefault();
      const first = panel.querySelector("[data-qa-row]");
      if (first) first.click();
    }
  });

  async function runSearch(q) {
    if (q === lastQuery) return;
    lastQuery = q;
    try {
      const data = await api("search_breeds", { query: q, limit: 8 });
      renderResults(q, data.matches ?? []);
    } catch {
      hidePanel();
    }
  }

  function renderResults(q, matches) {
    panel.innerHTML = "";
    for (const m of matches) {
      const row = document.createElement("div");
      row.dataset.qaRow = "1";
      Object.assign(row.style, {
        display: "flex", justifyContent: "space-between", alignItems: "center",
        gap: "10px", padding: "10px 14px", cursor: "pointer", fontSize: "13px",
      });
      row.addEventListener("mouseenter", () => row.style.background = "var(--color-surface-2)");
      row.addEventListener("mouseleave", () => row.style.background = "transparent");
      const reason = m.reason === "name" ? "exact" : (m.reason ?? "").replace("_", " ");
      row.innerHTML = `
        <div style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
          <strong>${escapeHtml(m.breed_name)}</strong>
          <span style="color:var(--color-secondary); font-size:12px; margin-left:6px;">${escapeHtml(reason)}</span>
        </div>
        <span style="color:var(--color-secondary); font-size:12px; flex-shrink:0;">Open editor →</span>`;
      row.addEventListener("click", () => {
        location.href = `profile.html?breed_id=${encodeURIComponent(m.breed_id)}`;
      });
      panel.appendChild(row);
    }
    const exactName = matches.find((m) => m.reason === "name" && (m.breed_name ?? "").toLowerCase() === q.toLowerCase());
    if (!exactName) {
      const create = document.createElement("div");
      create.dataset.qaRow = "1";
      Object.assign(create.style, {
        display: "flex", justifyContent: "space-between", alignItems: "center",
        gap: "10px", padding: "10px 14px", cursor: "pointer", fontSize: "13px",
        borderTop: matches.length ? "1px solid var(--color-border)" : "0",
        color: "var(--color-brand-deep)", fontWeight: "600",
      });
      create.addEventListener("mouseenter", () => create.style.background = "var(--color-surface-2)");
      create.addEventListener("mouseleave", () => create.style.background = "transparent");
      create.innerHTML = `
        <div>+ Add new breed: <strong>"${escapeHtml(q)}"</strong></div>
        <span style="color:var(--color-secondary); font-size:12px; font-weight:500;">Create + open editor</span>`;
      create.addEventListener("click", () => quickCreate(q, create));
      panel.appendChild(create);
    }
    panel.hidden = false;
  }

  async function quickCreate(name, rowEl) {
    const choice = await formDialog({
      title: `Add ${name}?`,
      fields: [
        { name: "breed_type", label: "Breed type", type: "select", required: true,
          options: [
            { value: "pure", label: "Pure breed" },
            { value: "cross", label: "Cross breed" },
          ] },
        { name: "groom_type", label: "Initial groom type", type: "select", required: true,
          options: [
            { value: "Pet Groom",   label: "Pet Groom (recommended baseline)" },
            { value: "Show",        label: "Show" },
            { value: "Sporting",    label: "Sporting" },
            { value: "Puppy",       label: "Puppy" },
            { value: "Maintenance", label: "Maintenance" },
            { value: "Hand Strip",  label: "Hand Strip" },
          ] },
      ],
      submitLabel: "Create + open editor",
    });
    if (!choice) return;

    if (rowEl) rowEl.style.opacity = "0.5";

    try {
      const breed = await api("save_breed", {
        breed: { breed_name: name, breed_type: choice.breed_type },
      });
      const profile = await api("create_profile", {
        breed_id: breed.breed_id,
        groom_type: choice.groom_type,
        source_type: "manual",
      });
      toastSuccess(`Created ${name} (${choice.groom_type}). Opening editor…`);
      location.href = `profile.html?profile_id=${encodeURIComponent(profile.profile_id)}`;
    } catch (err) {
      if (rowEl) rowEl.style.opacity = "1";
      if (err instanceof ApiError && err.code === "VALIDATION_FAILED") {
        toastError(err.message);
      }
    }
  }

  function hidePanel() {
    panel.hidden = true;
    panel.innerHTML = "";
    lastQuery = "";
  }
}
