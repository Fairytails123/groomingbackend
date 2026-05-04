// Home page — stat tiles, today's prep, oldest drafts, recently updated, quick-find.
//
// Hooks (all defined in admin/dashboard.html):
//   [data-stat="live-cards|needs-review|ready-to-publish|drafts"]
//   #home-meta              — page subtitle line
//   #today-card / #today-list   — today's appointments
//   #oldest-drafts          — 5 oldest Draft profiles
//   #recently-updated       — 3 most recently edited profiles
//   #home-quick-find        — quick-add typeahead
//
// Sidebar counts are populated by the shared admin/js/sidebar.js helper so
// every admin page benefits from one fetch per load.

import { requireSession, wireLogoutLink } from "../auth.js";
import { api, ApiError } from "../api.js";
import { formatRelativeTime } from "../format.js";
import { formDialog, toastError, toastSuccess } from "../ui.js";
import { populateSidebarCounts } from "../sidebar.js";

if (!requireSession()) throw new Error("redirecting to login");
wireLogoutLink();
populateSidebarCounts();

setHomeMeta();
wireQuickFind();

const todayListEl       = document.getElementById("today-list");
const oldestDraftsEl    = document.getElementById("oldest-drafts");
const recentlyUpdatedEl = document.getElementById("recently-updated");

// Per-panel .catch() so a slow or failing endpoint doesn't take down the rest.
Promise.all([
  loadStats().catch(() => clearStats()),
  loadTodayPrep(),
  loadOldestDrafts().catch(() => emptyList(oldestDraftsEl)),
  loadRecentlyUpdated().catch(() => emptyList(recentlyUpdatedEl)),
]);

// ─── Greeting line ──────────────────────────────────────────────────

function setHomeMeta() {
  const meta = document.getElementById("home-meta");
  if (!meta) return;
  const long = new Date().toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
  meta.textContent = `Today's overview · ${long}`;
}

// ─── Stats ──────────────────────────────────────────────────────────

async function loadStats() {
  const data = await api("dashboard_status_counts");
  const c = data.counts ?? {};
  setStat("live-cards",       c.Published ?? 0);
  setStat("needs-review",     c["Needs Review"] ?? 0);
  // TODO(api): "ready-to-publish" should be the count of Drafts that have all
  // required fields/photos. Until a validation op lands, use total Drafts as
  // a proxy — same number as the Drafts tile and the sidebar publish count.
  setStat("ready-to-publish", c.Draft ?? 0);
  setStat("drafts",           c.Draft ?? 0);
}

function setStat(key, value) {
  const el = document.querySelector(`[data-stat="${key}"]`);
  if (el) el.textContent = String(value);
}

function clearStats() {
  for (const k of ["live-cards", "needs-review", "ready-to-publish", "drafts"]) {
    setStat(k, "—");
  }
}

// ─── Today's prep ───────────────────────────────────────────────────

async function loadTodayPrep() {
  // TODO(api): wire #today-list when a today_prep op exists. The current
  // dashboard_tomorrow_prep op pulls *tomorrow's* bookings from tomorrow.json,
  // but the home card asks for *today's* bookings. The dashboard.css empty
  // state ":empty::before" renders "Nothing here yet." for us.
  if (todayListEl) todayListEl.innerHTML = "";
}

// ─── Oldest drafts ──────────────────────────────────────────────────

async function loadOldestDrafts() {
  if (!oldestDraftsEl) return;
  const data = await api("list_drafts");
  const drafts = (data.drafts ?? []).filter((d) => d.status === "Draft");
  // list_drafts is sorted updated_at DESC; sort ASC and take 5 to get oldest.
  const oldest = drafts
    .slice()
    .sort((a, b) => String(a.updated_at ?? "").localeCompare(String(b.updated_at ?? "")))
    .slice(0, 5);
  oldestDraftsEl.innerHTML = "";
  for (const d of oldest) {
    oldestDraftsEl.appendChild(buildBlogRow({
      label: `${d.breed_name} · ${d.groom_type}`,
      meta: ageFromIso(d.updated_at),
      href: `profile.html?profile_id=${encodeURIComponent(d.profile_id)}`,
    }));
  }
}

// ─── Recently updated ───────────────────────────────────────────────

async function loadRecentlyUpdated() {
  if (!recentlyUpdatedEl) return;
  const data = await api("dashboard_recent_uploads", { limit: 3 });
  const items = data.items ?? [];
  recentlyUpdatedEl.innerHTML = "";
  recentlyUpdatedEl.classList.add("blog");
  recentlyUpdatedEl.classList.remove("card__body");
  for (const item of items) {
    recentlyUpdatedEl.appendChild(buildBlogRow({
      label: `${item.breed_name} · ${item.groom_type}`,
      meta: formatRelativeTime(item.updated_at),
      href: `profile.html?profile_id=${encodeURIComponent(item.profile_id)}`,
    }));
  }
}

// ─── Shared helpers ─────────────────────────────────────────────────

function buildBlogRow({ label, meta, href }) {
  const a = document.createElement("a");
  a.className = "blog__row";
  a.href = href;
  const dot = document.createElement("div");
  dot.className = "blog__dot";
  const name = document.createElement("div");
  name.className = "blog__name";
  name.textContent = label;
  const age = document.createElement("div");
  age.className = "blog__age";
  age.textContent = meta;
  a.append(dot, name, age);
  return a;
}

function emptyList(el) {
  if (el) el.innerHTML = "";
}

function ageFromIso(iso) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "—";
  const days = Math.floor(ms / 86400000);
  if (days < 1) return "today";
  return `${days}d`;
}

// ─── Quick find (was #quick-add-input → #home-quick-find) ───────────

function wireQuickFind() {
  const input = document.getElementById("home-quick-find");
  if (!input) return;

  // The new HTML doesn't ship a results panel, so synthesise one anchored to
  // the .quickadd__input wrapper.
  const anchor = input.closest(".quickadd__input") ?? input.parentElement;
  if (!anchor) return;
  if (getComputedStyle(anchor).position === "static") {
    anchor.style.position = "relative";
  }
  const results = document.createElement("div");
  Object.assign(results.style, {
    position: "absolute",
    top: "calc(100% + 6px)",
    left: "0",
    right: "0",
    background: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-md)",
    boxShadow: "var(--shadow-lg)",
    zIndex: "20",
    overflow: "hidden",
  });
  results.hidden = true;
  anchor.appendChild(results);

  let debounceTimer = null;
  let lastQuery = "";

  input.addEventListener("input", () => {
    const q = input.value.trim();
    if (debounceTimer) clearTimeout(debounceTimer);
    if (!q) { hideResults(); return; }
    debounceTimer = setTimeout(() => runSearch(q), 200);
  });

  input.addEventListener("focus", () => {
    if (input.value.trim()) runSearch(input.value.trim());
  });

  document.addEventListener("click", (e) => {
    if (!input.contains(e.target) && !results.contains(e.target)) hideResults();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { hideResults(); input.blur(); }
    if (e.key === "Enter") {
      e.preventDefault();
      const first = results.querySelector("[data-quick-row]");
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
      hideResults();
    }
  }

  function renderResults(q, matches) {
    results.innerHTML = "";
    for (const m of matches) {
      const row = makeRow();
      const left = document.createElement("div");
      const strong = document.createElement("strong");
      strong.textContent = m.breed_name;
      const why = document.createElement("span");
      why.style.color = "var(--color-secondary)";
      why.style.fontSize = "12px";
      why.style.marginLeft = "6px";
      why.textContent = "— " + (m.reason === "name" ? "exact" : String(m.reason).replace("_", " "));
      left.append(strong, why);
      const right = document.createElement("span");
      right.style.color = "var(--color-secondary)";
      right.style.fontSize = "12px";
      right.textContent = "Open editor →";
      row.append(left, right);
      row.addEventListener("click", () => {
        location.href = `profile.html?breed_id=${encodeURIComponent(m.breed_id)}`;
      });
      results.appendChild(row);
    }

    // "Add new" entry only if the typed query doesn't exactly match an existing breed.
    const exactName = matches.find((m) =>
      m.reason === "name" && String(m.breed_name).toLowerCase() === q.toLowerCase()
    );
    if (!exactName) {
      const row = makeRow();
      row.style.borderTop = "1px dashed var(--color-border)";
      const left = document.createElement("div");
      const lead = document.createElement("span");
      lead.textContent = "+ Add new breed: ";
      const name = document.createElement("strong");
      name.textContent = `"${q}"`;
      left.append(lead, name);
      const right = document.createElement("span");
      right.style.color = "var(--color-secondary)";
      right.style.fontSize = "12px";
      right.textContent = "Creates a Pet Groom profile";
      row.append(left, right);
      row.addEventListener("click", () => quickCreate(q, row));
      results.appendChild(row);
    }
    results.hidden = false;
  }

  function makeRow() {
    const row = document.createElement("div");
    row.dataset.quickRow = "1";
    Object.assign(row.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "12px",
      padding: "10px 14px",
      cursor: "pointer",
      borderBottom: "1px solid var(--color-border)",
      fontSize: "13.5px",
      color: "var(--color-ink)",
    });
    row.addEventListener("mouseenter", () => row.style.background = "var(--color-surface-2)");
    row.addEventListener("mouseleave", () => row.style.background = "");
    return row;
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
    rowEl.style.opacity = "0.6";
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
      rowEl.style.opacity = "";
      if (err instanceof ApiError && err.code === "VALIDATION_FAILED") {
        toastError(err.message);
      }
    }
  }

  function hideResults() {
    results.hidden = true;
    results.innerHTML = "";
    lastQuery = "";
  }
}
