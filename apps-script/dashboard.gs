/**
 * dashboard.gs — Stage 5 read-only dashboard ops.
 *
 * Each op is cheap (single-sheet read) and returns the shape the
 * /admin/dashboard.html page expects. See admin/js/pages/dashboard.js.
 */

// ─── op: dashboard_status_counts ────────────────────────────────────

function op_dashboard_status_counts(body) {
  const { rows: profiles } = readSheet_("Groom Profiles");
  const counts = {};
  for (const p of profiles) {
    const s = String(p.status ?? "Draft");
    counts[s] = (counts[s] ?? 0) + 1;
  }
  return { counts };
}

// ─── op: dashboard_recent_uploads ───────────────────────────────────

function op_dashboard_recent_uploads(body) {
  const limit = Math.max(1, Math.min(50, Number(body.limit ?? 5)));
  const { rows: profiles } = readSheet_("Groom Profiles");
  const items = profiles
    .filter((p) => p.status !== "Archived")
    .map((p) => ({
      profile_id: p.profile_id,
      breed_id: p.breed_id,
      breed_name: p.breed_name,
      groom_type: p.groom_type,
      status: p.status,
      updated_at: toIso_(p.updated_at) ?? toIso_(p.created_at),
    }))
    .filter((p) => p.updated_at)
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
    .slice(0, limit);
  return { items };
}

// ─── op: dashboard_backlog ──────────────────────────────────────────

function op_dashboard_backlog(body) {
  const limit = Math.max(1, Math.min(50, Number(body.limit ?? 5)));
  const { rows } = readSheet_("Backlog Signals");
  const items = rows
    .filter((r) => r.current_status === "open")
    .map((r) => ({
      backlog_id: r.backlog_id,
      raw_breed: r.raw_breed,
      first_seen: toIso_(r.first_seen),
      last_seen: toIso_(r.last_seen),
      search_count: Number(r.search_count ?? 1),
      priority: Number(r.priority ?? 1),
      source: r.source,
    }))
    .sort((a, b) => (b.search_count - a.search_count) || (b.priority - a.priority))
    .slice(0, limit);
  return { items };
}

// ─── op: dashboard_alerts ───────────────────────────────────────────

function op_dashboard_alerts(body) {
  const limit = Math.max(1, Math.min(50, Number(body.limit ?? 10)));
  try {
    const { rows } = readSheet_("Operational Alerts");
    const items = rows
      .filter((r) => !r.acknowledged_at)
      .map((r) => ({
        alert_id: r.alert_id,
        severity: r.severity,
        source: r.source,
        message: r.message,
        created_at: toIso_(r.created_at),
      }))
      .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
      .slice(0, limit);
    return { items };
  } catch {
    return { items: [] };
  }
}

// ─── op: dashboard_tomorrow_prep ────────────────────────────────────
//
// Reads tomorrow.json straight from GitHub Pages (canonical), falling back
// to an empty list if it hasn't been generated yet. Avoids re-running the
// JotForm fetch on every dashboard load.

function op_dashboard_tomorrow_prep(body) {
  const owner = PropertiesService.getScriptProperties().getProperty("GITHUB_OWNER");
  const repo = PropertiesService.getScriptProperties().getProperty("GITHUB_REPO");
  if (!owner || !repo) return { breeds: [] };
  const url = `https://${owner}.github.io/${repo}/public/tomorrow.json`;
  try {
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return { breeds: [] };
    const pack = JSON.parse(resp.getContentText());
    const bookings = pack.bookings ?? [];

    // For each unique matched breed, look up KB status from Sheets so the UI
    // can render ✅/⚠️/❌ alongside.
    const seen = new Map();
    for (const b of bookings) {
      const key = b.matched ? `breed:${b.breed_id}` : `raw:${b.raw_breed}`;
      if (seen.has(key)) continue;
      seen.set(key, {
        breed_name: b.matched ? findBreedSafeName_(b.breed_id) : b.raw_breed,
        breed_id: b.breed_id,
        kb_status: b.matched ? breedKbStatus_(b.breed_id) : "missing",
        profile_id: b.matched ? findFirstProfileId_(b.breed_id) : null,
      });
    }
    return { breeds: [...seen.values()] };
  } catch {
    return { breeds: [] };
  }
}

function findBreedSafeName_(breedId) {
  try { return findBreed_(breedId).breed_name; } catch { return breedId; }
}

function findFirstProfileId_(breedId) {
  const { rows: profiles } = readSheet_("Groom Profiles");
  const candidate = profiles.find((p) => p.breed_id === breedId && p.status !== "Archived");
  return candidate?.profile_id ?? null;
}

// ─── op: get_version_history ────────────────────────────────────────

function op_get_version_history(body) {
  const profileId = String(body.profile_id ?? "").trim();
  if (!profileId) throw apiError_("VALIDATION_FAILED", "profile_id required");
  const limit = Math.max(1, Math.min(50, Number(body.limit ?? 20)));
  const { rows } = readSheet_("Version History");
  const items = rows
    .filter((r) => r.profile_id === profileId)
    .map((r) => ({
      version_id: r.version_id,
      change_type: r.change_type,
      actor: r.actor,
      reason: r.reason,
      created_at: toIso_(r.created_at),
    }))
    .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
    .slice(0, limit);
  return { items };
}
