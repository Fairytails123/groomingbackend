/**
 * breeds.gs — list, search, save breeds; resolve breed-match overrides.
 *
 * The Sheets workbook ID lives in ScriptProperty `SPREADSHEET_ID`. Sheet names:
 *   - Breeds
 *   - Groom Profiles
 *   - Breed Match Cache
 *   - Backlog Signals
 */

function getDb_() {
  const id = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (!id) throw apiError_("INTERNAL", "SPREADSHEET_ID not configured");
  return SpreadsheetApp.openById(id);
}

function readSheet_(name) {
  const sheet = getDb_().getSheetByName(name);
  if (!sheet) throw apiError_("INTERNAL", `Sheet '${name}' not found`);
  const range = sheet.getDataRange();
  const values = range.getValues();
  if (values.length < 2) return { sheet, headers: values[0] ?? [], rows: [] };
  const headers = values[0];
  const rows = values.slice(1).map((row) => {
    const obj = { _rowIndex: 0 };  // placeholder; filled below
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });
  rows.forEach((r, i) => { r._rowIndex = i + 2; });   // sheet row number (1-based, +1 for header)
  return { sheet, headers, rows };
}

// ─── op: list_breeds ────────────────────────────────────────────────

function op_list_breeds(body) {
  const { rows: breeds } = readSheet_("Breeds");
  const { rows: profiles } = readSheet_("Groom Profiles");

  // Aggregate profile counts per breed.
  const profileCount = {};
  const publishedCount = {};
  const hasPetGroom = {};
  for (const p of profiles) {
    const bId = p.breed_id;
    if (!bId) continue;
    if (p.status === "Archived") continue;
    profileCount[bId] = (profileCount[bId] ?? 0) + 1;
    if (p.status === "Published") publishedCount[bId] = (publishedCount[bId] ?? 0) + 1;
    if (p.groom_type === "Pet Groom" && p.status === "Published") hasPetGroom[bId] = true;
  }

  const filter = body.filter ?? {};
  let result = breeds.filter((b) => {
    if (b.status === "archived") return false;
    if (filter.breed_type && b.breed_type !== filter.breed_type) return false;
    if (filter.search) {
      const q = String(filter.search).toLowerCase();
      const haystack = [
        b.breed_name,
        ...parseJsonArray_(b.alternative_names),
        ...parseJsonArray_(b.common_jotform_names),
      ].join(" ").toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  result = result.map((b) => ({
    breed_id: b.breed_id,
    breed_name: b.breed_name,
    slug: b.slug,
    breed_type: b.breed_type,
    profile_count: profileCount[b.breed_id] ?? 0,
    published_count: publishedCount[b.breed_id] ?? 0,
    has_pet_groom: !!hasPetGroom[b.breed_id],
    last_updated: toIso_(b.last_updated),
    alternative_names: parseJsonArray_(b.alternative_names),
    common_jotform_names: parseJsonArray_(b.common_jotform_names),
  }));

  // Stable sort by breed_name (case-insensitive).
  result.sort((a, b) => a.breed_name.localeCompare(b.breed_name, "en"));
  return { breeds: result };
}

// ─── op: save_breed (create-or-update) ──────────────────────────────

function op_save_breed(body) {
  const breed = body.breed ?? {};
  if (!breed.breed_name || typeof breed.breed_name !== "string") {
    throw apiError_("VALIDATION_FAILED", "breed_name required");
  }
  const breedType = breed.breed_type ?? "pure";
  if (breedType !== "pure" && breedType !== "cross") {
    throw apiError_("VALIDATION_FAILED", "breed_type must be 'pure' or 'cross'");
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw apiError_("INTERNAL", "Couldn't acquire write lock");
  try {
    const { sheet, headers, rows } = readSheet_("Breeds");
    const trimmed = breed.breed_name.trim();

    // Update existing if breed_id provided
    if (breed.breed_id) {
      const row = rows.find((r) => r.breed_id === breed.breed_id);
      if (!row) throw apiError_("NOT_FOUND", `breed_id '${breed.breed_id}' not found`);
      writeRow_(sheet, headers, row._rowIndex, {
        breed_name: trimmed,
        breed_type: breedType,
        parent_breeds: JSON.stringify(breed.parent_breeds ?? []),
        alternative_names: JSON.stringify(breed.alternative_names ?? []),
        common_jotform_names: JSON.stringify(breed.common_jotform_names ?? []),
        notes: breed.notes ?? "",
        last_updated: nowIso_(),
      });
      return { breed_id: row.breed_id };
    }

    // Create new
    const lowerName = trimmed.toLowerCase();
    const collision = rows.find((r) => String(r.breed_name ?? "").toLowerCase() === lowerName);
    if (collision) {
      throw apiError_("VALIDATION_FAILED", `Breed '${trimmed}' already exists`);
    }
    const breedId = nextId_("breed");
    const existingSlugs = new Set(rows.map((r) => r.slug).filter(Boolean));
    const slug = uniqueBreedSlug_(trimmed, breedId, existingSlugs);

    const newRow = {
      breed_id: breedId,
      breed_name: trimmed,
      slug,
      breed_type: breedType,
      parent_breeds: JSON.stringify(breed.parent_breeds ?? []),
      alternative_names: JSON.stringify(breed.alternative_names ?? []),
      common_jotform_names: JSON.stringify(breed.common_jotform_names ?? []),
      notes: breed.notes ?? "",
      status: "active",
      created_date: nowIso_(),
      last_updated: nowIso_(),
    };
    appendRow_(sheet, headers, newRow);
    return { breed_id: breedId, slug };
  } finally {
    lock.releaseLock();
  }
}

// ─── op: search_breeds ──────────────────────────────────────────────

function op_search_breeds(body) {
  const q = String(body.query ?? "").trim().toLowerCase();
  const limit = Math.max(1, Math.min(20, Number(body.limit ?? 10)));
  if (!q) return { matches: [] };

  const { rows: breeds } = readSheet_("Breeds");
  const matches = [];
  for (const b of breeds) {
    if (b.status === "archived") continue;
    let bestScore = 0;
    let reason = "";
    const checks = [
      { value: b.breed_name, kind: "name", weight: 1.0 },
      ...parseJsonArray_(b.alternative_names).map((n) => ({ value: n, kind: "alt_name", weight: 0.95 })),
      ...parseJsonArray_(b.common_jotform_names).map((n) => ({ value: n, kind: "jotform_name", weight: 0.9 })),
    ];
    for (const c of checks) {
      const v = String(c.value ?? "").toLowerCase();
      if (!v) continue;
      let score = 0;
      if (v === q)             score = 1.0 * c.weight;
      else if (v.startsWith(q)) score = 0.85 * c.weight;
      else if (v.includes(q))   score = 0.7 * c.weight;
      if (score > bestScore) { bestScore = score; reason = c.kind; }
    }
    if (bestScore > 0.4) {
      matches.push({
        breed_id: b.breed_id,
        breed_name: b.breed_name,
        slug: b.slug,
        score: bestScore,
        reason,
      });
    }
  }
  matches.sort((a, b) => b.score - a.score);
  return { matches: matches.slice(0, limit) };
}

// ─── op: override_breed_match ───────────────────────────────────────

function op_override_breed_match(body) {
  const rawBreed = String(body.raw_breed ?? "").trim();
  const matchedId = body.matched_breed_id;
  if (!rawBreed) throw apiError_("VALIDATION_FAILED", "raw_breed required");
  if (!matchedId) throw apiError_("VALIDATION_FAILED", "matched_breed_id required");

  const { rows: breeds } = readSheet_("Breeds");
  const matched = breeds.find((b) => b.breed_id === matchedId);
  if (!matched) throw apiError_("NOT_FOUND", `breed_id '${matchedId}' not found`);

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw apiError_("INTERNAL", "Couldn't acquire write lock");
  try {
    const cacheSheet = getDb_().getSheetByName("Breed Match Cache");
    if (!cacheSheet) throw apiError_("INTERNAL", "Sheet 'Breed Match Cache' not found");
    const { headers, rows } = readSheet_("Breed Match Cache");
    const existing = rows.find((r) => String(r.raw_breed ?? "").toLowerCase() === rawBreed.toLowerCase());

    if (existing) {
      writeRow_(cacheSheet, headers, existing._rowIndex, {
        matched_breed_id: matchedId,
        matched_breed_name: matched.breed_name,
        confidence: 1.0,
        source: "manual",
        last_seen: nowIso_(),
        hit_count: Number(existing.hit_count ?? 0) + 1,
      });
    } else {
      const cacheId = nextId_("cache");
      appendRow_(cacheSheet, headers, {
        cache_id: cacheId,
        raw_breed: rawBreed,
        matched_breed_id: matchedId,
        matched_breed_name: matched.breed_name,
        confidence: 1.0,
        source: "manual",
        first_seen: nowIso_(),
        last_seen: nowIso_(),
        hit_count: 1,
      });
    }

    // Resolve any open backlog row.
    const { rows: backlog } = readSheet_("Backlog Signals");
    const backlogSheet = getDb_().getSheetByName("Backlog Signals");
    const open = backlog.find((r) =>
      String(r.raw_breed ?? "").toLowerCase() === rawBreed.toLowerCase()
      && r.current_status !== "done");
    if (open) {
      writeRow_(backlogSheet, readSheet_("Backlog Signals").headers, open._rowIndex, {
        current_status: "done",
        resolved_breed_id: matchedId,
        last_seen: nowIso_(),
      });
    }

    return { matched_breed_id: matchedId };
  } finally {
    lock.releaseLock();
  }
}

// ─── Sheet write helpers ────────────────────────────────────────────

function appendRow_(sheet, headers, obj) {
  const row = headers.map((h) => obj[h] ?? "");
  sheet.appendRow(row);
}

function writeRow_(sheet, headers, rowIndex, patch) {
  // Read current row, merge, write back. Preserves columns not in `patch`.
  const range = sheet.getRange(rowIndex, 1, 1, headers.length);
  const current = range.getValues()[0];
  const next = headers.map((h, i) => (h in patch) ? patch[h] : current[i]);
  range.setValues([next]);
}

function parseJsonArray_(s) {
  if (Array.isArray(s)) return s;
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

function nowIso_() { return new Date().toISOString(); }
function toIso_(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") return v;
  return null;
}
