/**
 * dashboard.gs — Stage 5 read-only dashboard ops.
 *
 * Each op is cheap (single-sheet read) and returns the shape the
 * /admin/dashboard.html page expects. See admin/js/pages/dashboard.js.
 */

// ─── op: dashboard_summary ──────────────────────────────────────────
//
// Single round-trip for the redesigned home page + every admin page's
// sidebar counts. Reads each sheet exactly once and computes:
//   - counts: { published, needs_review, ready_to_publish, drafts, breeds }
//   - oldest_drafts (limit=5, oldest updated_at first)
//   - recently_updated (limit=3, newest updated_at first, non-Archived)
//
// "ready_to_publish" reuses the same checks as op_publish_profile (5 core
// sections present + non-empty, main image with valid crop bounds, valid
// groom_type, breed has slug). Pre-loads sheets once so the per-Draft
// readiness check is O(profiles) not O(profiles * sheet-reads).

function op_dashboard_summary(body) {
  const { rows: breeds } = readSheet_("Breeds");
  const { rows: profiles } = readSheet_("Groom Profiles");
  const { rows: sections } = readSheet_("Groom Knowledge");
  const { rows: images } = readSheet_("Images");
  const { rows: renders } = readSheet_("Page Renders");

  const breedsById = new Map();
  for (const b of breeds) {
    if (b.status === "archived") continue;
    breedsById.set(b.breed_id, b);
  }

  const sectionsByProfile = new Map();
  for (const s of sections) {
    const arr = sectionsByProfile.get(s.profile_id) ?? [];
    arr.push(s);
    sectionsByProfile.set(s.profile_id, arr);
  }

  const imagesByProfile = new Map();
  for (const i of images) {
    const arr = imagesByProfile.get(i.profile_id) ?? [];
    arr.push(i);
    imagesByProfile.set(i.profile_id, arr);
  }

  const rendersById = new Map();
  for (const r of renders) rendersById.set(r.page_render_id, r);

  let published = 0, needsReview = 0, drafts = 0, readyToPublish = 0;
  for (const p of profiles) {
    if (p.status === "Archived") continue;
    if (p.status === "Published") published++;
    if (p.status === "Needs Review") needsReview++;
    if (p.status === "Draft") {
      drafts++;
      const breed = breedsById.get(p.breed_id);
      if (breed && isProfilePublishable_(p, breed, sectionsByProfile, imagesByProfile, rendersById)) {
        readyToPublish++;
      }
    }
  }

  const projectRow = (p) => ({
    profile_id: p.profile_id,
    breed_id: p.breed_id,
    breed_name: p.breed_name,
    groom_type: p.groom_type,
    status: p.status,
    updated_at: toIso_(p.updated_at) ?? toIso_(p.created_at),
  });

  const oldestDrafts = profiles
    .filter((p) => p.status === "Draft" || p.status === "Needs Review")
    .map(projectRow)
    .filter((p) => p.updated_at)
    .sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at)))
    .slice(0, 5);

  const recentlyUpdated = profiles
    .filter((p) => p.status !== "Archived")
    .map(projectRow)
    .filter((p) => p.updated_at)
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
    .slice(0, 3);

  return {
    counts: {
      published,
      needs_review: needsReview,
      ready_to_publish: readyToPublish,
      drafts,
      breeds: breedsById.size,
    },
    oldest_drafts: oldestDrafts,
    recently_updated: recentlyUpdated,
  };
}

// Mirror of validatePublishable_ but takes pre-loaded maps so it can be
// called per-profile without re-reading sheets. Returns boolean.
function isProfilePublishable_(profile, breed, sectionsByProfile, imagesByProfile, rendersById) {
  if (!VALID_GROOM_TYPES.includes(profile.groom_type)) return false;
  if (!breed?.slug) return false;

  const sections = sectionsByProfile.get(profile.profile_id) ?? [];
  const sectionsByName = Object.fromEntries(sections.map((s) => [s.section_name, s]));
  for (const core of CORE_SECTIONS) {
    const sec = sectionsByName[core];
    if (!sec) return false;
    if (!String(sec.section_text ?? "").trim()) return false;
  }

  const profileImages = imagesByProfile.get(profile.profile_id) ?? [];
  const main = profileImages.find((i) => i.image_role === "main");
  if (!main) return false;
  if (main.source_page_render_id) {
    const render = rendersById.get(main.source_page_render_id);
    if (render) {
      const x = Number(main.crop_x ?? 0), y = Number(main.crop_y ?? 0);
      const w = Number(main.crop_w ?? 0), h = Number(main.crop_h ?? 0);
      const W = Number(render.width_px ?? 0), H = Number(render.height_px ?? 0);
      if (W > 0 && H > 0 && (x + w > W || y + h > H || w <= 0 || h <= 0)) return false;
    }
  }
  return true;
}

// ─── op: dashboard_today_prep ───────────────────────────────────────
//
// Reads today.json from GitHub Pages (built by op_rebuild_today_json on
// JotForm bookings). Returns one row per unique matched breed plus
// appointment time when available. If today.json hasn't been built yet
// (e.g. Sunday or before the cron has run), returns an empty list.

function op_dashboard_today_prep(body) {
  const owner = PropertiesService.getScriptProperties().getProperty("GITHUB_OWNER");
  const repo = PropertiesService.getScriptProperties().getProperty("GITHUB_REPO");
  if (!owner || !repo) return { breeds: [] };
  const url = `https://${owner}.github.io/${repo}/public/today.json`;
  try {
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return { breeds: [] };
    const pack = JSON.parse(resp.getContentText());
    const bookings = pack.bookings ?? [];

    const seen = new Map();
    for (const b of bookings) {
      const key = b.matched ? `breed:${b.breed_id}` : `raw:${b.raw_breed}`;
      if (seen.has(key)) continue;
      seen.set(key, {
        breed_name: b.matched ? findBreedSafeName_(b.breed_id) : b.raw_breed,
        breed_id: b.breed_id,
        kb_status: b.matched ? breedKbStatus_(b.breed_id) : "missing",
        profile_id: b.matched ? findFirstProfileId_(b.breed_id) : null,
        appointment_time: extractTimeFromIso_(b.appointment_datetime),
      });
    }
    return { breeds: [...seen.values()] };
  } catch {
    return { breeds: [] };
  }
}

function extractTimeFromIso_(iso) {
  if (!iso || typeof iso !== "string") return null;
  const m = iso.match(/T(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : null;
}

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

// ─── op: acknowledge_alert ─────────────────────────────────────────
//
// Marks an Operational Alerts row as acknowledged so it stops appearing on
// the dashboard. We patch acknowledged_at + acknowledged_by; the row is kept
// for audit. Idempotent — second ack is a no-op (returns the existing
// acknowledged_at).

function op_acknowledge_alert(body) {
  const alertId = requireString_(body.alert_id, "alert_id", { maxLength: 64 });

  const alertsSheet = getDb_().getSheetByName("Operational Alerts");
  if (!alertsSheet) throw apiError_("INTERNAL", "Operational Alerts sheet missing");
  const { headers, rows } = readSheet_("Operational Alerts");

  const row = rows.find((r) => r.alert_id === alertId);
  if (!row) throw apiError_("NOT_FOUND", `alert '${alertId}' not found`);

  if (row.acknowledged_at) {
    return {
      alert_id: alertId,
      acknowledged_at: toIso_(row.acknowledged_at),
      already_acknowledged: true,
    };
  }

  const now = nowIso_();
  writeRow_(alertsSheet, headers, row._rowIndex, {
    acknowledged_at: now,
    acknowledged_by: "admin",
  });
  return {
    alert_id: alertId,
    acknowledged_at: now,
    already_acknowledged: false,
  };
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

// ─── op: health_check ───────────────────────────────────────────────
//
// Surface backend wiring state to the dashboard. Returns:
//   - script_properties: which Properties are set (boolean only — never the
//                        values, so the dashboard never leaks secrets).
//   - sheet_counts: row counts for the most operationally relevant sheets.
//   - last_ai_call: shape { created_at, model, success, source } for the
//                   most recent AI Call Log entry (or null if none).
//   - openai_today_gbp: total estimated AI cost for today (UTC).
//   - server_time: ISO timestamp.
//
// Read-only and cheap (a few sheet reads). Used by a small status panel
// on the dashboard so Kamal can see at a glance whether GITHUB_PAT /
// OPENAI_API_KEY etc. are wired without opening the Apps Script editor.

function op_health_check(body) {
  const props = PropertiesService.getScriptProperties();
  const required = [
    "ADMIN_PASSWORD_HASH", "ADMIN_PASSWORD_SALT", "SESSION_SECRET",
    "SPREADSHEET_ID", "DRIVE_ROOT_ID",
    "GITHUB_OWNER", "GITHUB_REPO", "GITHUB_PAT",
    "OPENAI_API_KEY", "JOTFORM_API_KEY",
    "JOTFORM_FIELD_BREED", "JOTFORM_FIELD_DOG_NAME",
    "JOTFORM_FIELD_APPT_TYPE", "JOTFORM_FIELD_DATE_FG_BUS",
    "JOTFORM_FIELD_DATE_FG_PRT",
  ];
  const optional = [
    "OPENAI_DAILY_CAP_GBP", "OPENAI_USD_TO_GBP",
    "JOTFORM_API_BASE", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID",
  ];
  const scriptProperties = {};
  for (const k of required) scriptProperties[k] = { required: true, set: !!props.getProperty(k) };
  for (const k of optional) scriptProperties[k] = { required: false, set: !!props.getProperty(k) };

  const sheetCounts = {};
  for (const name of ["Breeds", "Groom Profiles", "Groom Knowledge", "Images", "Page Renders", "Operational Alerts", "AI Call Log"]) {
    try {
      const { rows } = readSheet_(name);
      sheetCounts[name] = rows.length;
    } catch {
      sheetCounts[name] = null;
    }
  }

  // Most recent AI call (cheap — sheet read, sort by created_at desc, take first)
  let lastAiCall = null;
  try {
    const { rows } = readSheet_("AI Call Log");
    if (rows.length) {
      const sorted = rows.slice().sort((a, b) =>
        String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))
      );
      const r = sorted[0];
      lastAiCall = {
        created_at: toIso_(r.created_at),
        model: String(r.model ?? ""),
        source: String(r.source ?? ""),
        success: String(r.success ?? "").toUpperCase() === "TRUE",
        error_code: String(r.error_code ?? ""),
      };
    }
  } catch {}

  // Today's AI spend (UTC day, in GBP).
  let openaiTodayGbp = 0;
  try {
    const fxRate = Number(props.getProperty("OPENAI_USD_TO_GBP") ?? 0.85);
    const todayStart = todayStartUtcIso_();
    const { rows } = readSheet_("AI Call Log");
    let usd = 0;
    for (const r of rows) {
      if (toIso_(r.created_at) >= todayStart) usd += Number(r.cost_usd ?? 0);
    }
    openaiTodayGbp = Number((usd * fxRate).toFixed(4));
  } catch {}

  return {
    server_time: nowIso_(),
    script_properties: scriptProperties,
    sheet_counts: sheetCounts,
    last_ai_call: lastAiCall,
    openai_today_gbp: openaiTodayGbp,
  };
}
