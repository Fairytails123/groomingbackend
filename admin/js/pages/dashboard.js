// Dashboard page — tomorrow's prep, status counts, recent uploads, backlog.

import { requireSession, wireLogoutLink } from "../auth.js";
import { api, ApiError } from "../api.js";
import { formatRelativeTime, formatDate, pluralise } from "../format.js";
import { statusPill, formDialog, toast, toastError, toastSuccess } from "../ui.js";

if (!requireSession()) throw new Error("redirecting to login");
wireLogoutLink();

wireQuickAdd();

const tomorrowDateEl = document.getElementById("tomorrow-date");
const tomorrowListEl = document.getElementById("tomorrow-list");
const statusCountsEl = document.getElementById("status-counts");
const recentListEl   = document.getElementById("recent-list");
const backlogListEl  = document.getElementById("backlog-list");
const alertsListEl   = document.getElementById("alerts-list");
const healthPanelEl  = document.getElementById("health-panel");

(async () => {
  // Show tomorrow's date in the panel header.
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrowDateEl.textContent = formatDate(tomorrow.toISOString());

  // Fan out reads in parallel. Each panel renders independently so a slow
  // endpoint doesn't block the rest.
  await Promise.all([
    loadTomorrowPrep(),
    loadStatusCounts(),
    loadRecentUploads(),
    loadBacklog(),
    loadAlerts(),
    loadHealth(),
  ]);
})();

async function loadAlerts() {
  try {
    const data = await api("dashboard_alerts", { limit: 5 }).catch(() => ({ items: [] }));
    const items = data.items ?? [];
    if (items.length === 0) {
      alertsListEl.innerHTML = `<p class="muted">No open alerts. ✓</p>`;
      return;
    }
    alertsListEl.innerHTML = "";
    for (const a of items) {
      const row = document.createElement("div");
      row.className = "row row--space-between";
      row.style.padding = "var(--space-2) 0";
      row.style.borderBottom = "1px solid var(--color-border)";
      const sevColor = a.severity === "critical" ? "var(--color-error)"
                     : a.severity === "error"    ? "var(--color-error)"
                     : a.severity === "warning"  ? "var(--color-warning)"
                     : "var(--color-text-muted)";
      row.innerHTML = `
        <div style="flex:1;">
          <span class="pill" style="background:${sevColor}20; color:${sevColor};">${a.severity}</span>
          <span style="margin-left:var(--space-2);">${escapeHtml(a.message)}</span>
        </div>
        <span class="muted" style="font-size:var(--font-size-sm); margin-right:var(--space-3);">${escapeHtml(a.source)}</span>`;

      const dismissBtn = document.createElement("button");
      dismissBtn.className = "btn btn--small btn--secondary";
      dismissBtn.textContent = "Dismiss";
      dismissBtn.addEventListener("click", async () => {
        dismissBtn.disabled = true;
        const original = dismissBtn.textContent;
        dismissBtn.textContent = "Dismissing…";
        try {
          await api("acknowledge_alert", { alert_id: a.alert_id });
          // Optimistically fade and remove the row.
          row.style.transition = "opacity 200ms";
          row.style.opacity = "0.4";
          setTimeout(() => {
            row.remove();
            // If the list is now empty, restore the empty-state message.
            if (!alertsListEl.querySelector("div")) {
              alertsListEl.innerHTML = `<p class="muted">No open alerts. ✓</p>`;
            }
          }, 200);
        } catch (err) {
          dismissBtn.disabled = false;
          dismissBtn.textContent = original;
          toastError(err?.message ?? "Could not dismiss alert.");
        }
      });
      row.appendChild(dismissBtn);

      alertsListEl.appendChild(row);
    }
  } catch {
    alertsListEl.innerHTML = `<p class="muted">Alerts unavailable.</p>`;
  }
}

async function loadTomorrowPrep() {
  // Until WF-02's tomorrow-prep endpoint is wired (Stage 4), the dashboard
  // panel reads from a placeholder API op that returns an empty list early in
  // build. This fetch will surface the empty state cleanly.
  try {
    const data = await api("dashboard_tomorrow_prep").catch(() => ({ breeds: [] }));
    const breeds = data.breeds ?? [];
    if (breeds.length === 0) {
      tomorrowListEl.innerHTML = `<p class="muted">No bookings for tomorrow yet, or the prep endpoint isn't deployed yet.</p>`;
      return;
    }
    tomorrowListEl.innerHTML = "";
    for (const b of breeds) {
      const row = document.createElement("div");
      row.className = "row row--space-between";
      row.style.padding = "var(--space-3) 0";
      row.style.borderBottom = "1px solid var(--color-border)";
      const icon = b.kb_status === "published" ? "✅"
                 : b.kb_status === "draft"     ? "⚠️"
                 : "❌";
      row.innerHTML = `
        <div>
          <span style="font-size:var(--font-size-lg);">${icon}</span>
          <strong>${escapeHtml(b.breed_name)}</strong>
          <span class="muted"> — ${escapeHtml(b.kb_status)}</span>
        </div>`;
      const actionLink = document.createElement("a");
      actionLink.className = "btn btn--small btn--secondary";
      if (b.kb_status === "published" || b.kb_status === "draft") {
        actionLink.href = `profile.html?profile_id=${encodeURIComponent(b.profile_id)}`;
        actionLink.textContent = b.kb_status === "draft" ? "Review & publish" : "Open";
      } else {
        actionLink.href = `upload.html?breed_name=${encodeURIComponent(b.breed_name)}`;
        actionLink.textContent = "Upload PDF";
      }
      row.appendChild(actionLink);
      tomorrowListEl.appendChild(row);
    }
  } catch (err) {
    tomorrowListEl.innerHTML = `<p class="muted">Couldn't load tomorrow's prep.</p>`;
  }
}

async function loadStatusCounts() {
  try {
    const data = await api("dashboard_status_counts").catch(() => ({ counts: {} }));
    const counts = data.counts ?? {};
    const labels = ["Published", "Draft", "Needs Review", "Processing", "Failed"];
    statusCountsEl.innerHTML = "";
    statusCountsEl.style.display = "flex";
    statusCountsEl.style.gap = "var(--space-3)";
    statusCountsEl.style.flexWrap = "wrap";
    for (const label of labels) {
      const wrap = document.createElement("div");
      wrap.style.flex = "1";
      wrap.style.minWidth = "100px";
      wrap.innerHTML = `
        <div style="font-size:var(--font-size-2xl); font-weight:bold; color:var(--color-brand-deep);">${counts[label] ?? 0}</div>
        <div class="muted" style="font-size:var(--font-size-sm);">${label}</div>`;
      statusCountsEl.appendChild(wrap);
    }
  } catch {
    statusCountsEl.innerHTML = `<p class="muted">Counts unavailable.</p>`;
  }
}

async function loadRecentUploads() {
  try {
    const data = await api("dashboard_recent_uploads", { limit: 5 }).catch(() => ({ items: [] }));
    const items = data.items ?? [];
    if (items.length === 0) {
      recentListEl.innerHTML = `<p class="muted">No recent uploads.</p>`;
      return;
    }
    recentListEl.innerHTML = "";
    for (const item of items) {
      const row = document.createElement("div");
      row.className = "row row--space-between";
      row.style.padding = "var(--space-2) 0";
      row.innerHTML = `
        <div>
          <a href="profile.html?profile_id=${encodeURIComponent(item.profile_id)}">${escapeHtml(item.breed_name)} / ${escapeHtml(item.groom_type)}</a>
        </div>`;
      const right = document.createElement("div");
      right.className = "row";
      right.style.gap = "var(--space-3)";
      right.appendChild(statusPill(item.status));
      const time = document.createElement("span");
      time.className = "muted";
      time.style.fontSize = "var(--font-size-sm)";
      time.textContent = formatRelativeTime(item.updated_at);
      right.appendChild(time);
      row.appendChild(right);
      recentListEl.appendChild(row);
    }
  } catch {
    recentListEl.innerHTML = `<p class="muted">Recent uploads unavailable.</p>`;
  }
}

async function loadBacklog() {
  try {
    const data = await api("dashboard_backlog", { limit: 5 }).catch(() => ({ items: [] }));
    const items = data.items ?? [];
    if (items.length === 0) {
      backlogListEl.innerHTML = `<p class="muted">No unmatched breeds.</p>`;
      return;
    }
    backlogListEl.innerHTML = "";
    for (const item of items) {
      const row = document.createElement("div");
      row.className = "row row--space-between";
      row.style.padding = "var(--space-2) 0";
      row.innerHTML = `
        <div><strong>${escapeHtml(item.raw_breed)}</strong></div>
        <div class="muted">${pluralise(item.search_count, "hit")}</div>`;
      backlogListEl.appendChild(row);
    }
  } catch {
    backlogListEl.innerHTML = `<p class="muted">Backlog unavailable.</p>`;
  }
}

async function loadHealth() {
  if (!healthPanelEl) return;
  try {
    const data = await api("health_check").catch(() => null);
    if (!data) {
      healthPanelEl.innerHTML = `<p class="muted">Health check unavailable.</p>`;
      return;
    }
    const sp = data.script_properties ?? {};
    const sheetCounts = data.sheet_counts ?? {};
    const last = data.last_ai_call;
    const todayGbp = Number(data.openai_today_gbp ?? 0);

    // Group properties: show pending (required + not set) loudly,
    // then required+set in muted text, then optional ones at the bottom.
    const required = Object.entries(sp).filter(([_, v]) => v.required);
    const optional = Object.entries(sp).filter(([_, v]) => !v.required);
    const missing = required.filter(([_, v]) => !v.set).map(([k]) => k);
    const setRequired = required.filter(([_, v]) => v.set).map(([k]) => k);
    const setOptional = optional.filter(([_, v]) => v.set).map(([k]) => k);

    const formatPills = (names, color) => names.map((n) =>
      `<span class="pill" style="background:${color}20; color:${color}; font-family:var(--font-mono); font-size:var(--font-size-xs);">${escapeHtml(n)}</span>`
    ).join(" ");

    const lastAiHtml = last
      ? `<span class="muted">Last AI call:</span> <strong>${escapeHtml(last.source)}</strong> (${escapeHtml(last.model)}) — ${last.success ? "✓ success" : `✗ ${escapeHtml(last.error_code || "failed")}`} <span class="muted">${formatRelativeTime(last.created_at)}</span>`
      : `<span class="muted">No AI calls yet.</span>`;

    healthPanelEl.innerHTML = `
      <div class="stack" style="gap:var(--space-3);">
        ${missing.length ? `
          <div>
            <div class="muted" style="font-size:var(--font-size-sm); margin-bottom:var(--space-1);">Required Properties not set (${missing.length}):</div>
            <div>${formatPills(missing, "var(--color-error)")}</div>
          </div>` : `
          <div class="muted" style="font-size:var(--font-size-sm);">All required Script Properties are set ✓</div>`}

        ${setRequired.length ? `
          <details>
            <summary class="muted" style="font-size:var(--font-size-sm); cursor:pointer;">${setRequired.length} required Properties set</summary>
            <div style="margin-top:var(--space-2);">${formatPills(setRequired, "var(--color-text-muted)")}</div>
          </details>` : ``}

        ${setOptional.length ? `
          <details>
            <summary class="muted" style="font-size:var(--font-size-sm); cursor:pointer;">${setOptional.length} optional Properties set</summary>
            <div style="margin-top:var(--space-2);">${formatPills(setOptional, "var(--color-text-muted)")}</div>
          </details>` : ``}

        <div class="row" style="gap:var(--space-4); flex-wrap:wrap; padding-top:var(--space-2); border-top:1px solid var(--color-border);">
          <div>
            <div class="muted" style="font-size:var(--font-size-xs);">Today's AI spend</div>
            <div style="font-weight:bold; font-size:var(--font-size-lg);">£${todayGbp.toFixed(2)}</div>
          </div>
          ${Object.entries(sheetCounts).filter(([_, v]) => v != null).map(([name, count]) => `
            <div>
              <div class="muted" style="font-size:var(--font-size-xs);">${escapeHtml(name)}</div>
              <div style="font-weight:bold; font-size:var(--font-size-lg);">${count}</div>
            </div>`).join("")}
        </div>

        <div style="font-size:var(--font-size-sm); border-top:1px solid var(--color-border); padding-top:var(--space-2);">
          ${lastAiHtml}
        </div>
      </div>
    `;
  } catch {
    healthPanelEl.innerHTML = `<p class="muted">Health check unavailable.</p>`;
  }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Quick add or update breed ──────────────────────────────────────

function wireQuickAdd() {
  const input = document.getElementById("quick-add-input");
  const results = document.getElementById("quick-add-results");
  if (!input || !results) return;

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

  // Close dropdown when clicking outside
  document.addEventListener("click", (e) => {
    if (!input.contains(e.target) && !results.contains(e.target)) hideResults();
  });

  // Esc closes
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { hideResults(); input.blur(); }
    if (e.key === "Enter") {
      e.preventDefault();
      const first = results.querySelector(".quick-add__row");
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
      const row = document.createElement("div");
      row.className = "quick-add__row";
      row.innerHTML = `
        <div>
          <strong>${escapeHtml(m.breed_name)}</strong>
          <span class="quick-add__row-meta"> — ${m.reason === "name" ? "exact" : m.reason.replace("_", " ")}</span>
        </div>
        <span class="quick-add__row-meta">Open editor →</span>`;
      row.addEventListener("click", () => {
        location.href = `profile.html?breed_id=${encodeURIComponent(m.breed_id)}`;
      });
      results.appendChild(row);
    }
    // "Add new" option only if no exact-match (name) match exists
    const exactName = matches.find((m) => m.reason === "name" && m.breed_name.toLowerCase() === q.toLowerCase());
    if (!exactName) {
      const create = document.createElement("div");
      create.className = "quick-add__row quick-add__create";
      create.innerHTML = `
        <div>+ Add new breed: <strong>"${escapeHtml(q)}"</strong></div>
        <span class="quick-add__row-meta">Creates a Pet Groom profile and opens the editor</span>`;
      create.addEventListener("click", () => quickCreate(q, create));
      results.appendChild(create);
    }
    results.hidden = false;
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

    rowEl?.classList.add("quick-add__row--working");
    rowEl?.querySelector(":nth-child(2)")?.replaceChildren(document.createTextNode("Creating…"));

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
      rowEl?.classList.remove("quick-add__row--working");
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
