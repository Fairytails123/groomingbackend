/**
 * matcher.gs — token-based fuzzy breed matcher with confidence scoring.
 *
 * Spec §6.2 logic:
 *   1. Check Breed Match Cache for exact `raw_breed` match → use it.
 *   2. Token-based fuzzy match against breed_name + alternative_names + common_jotform_names.
 *   3. If confidence ≥ 0.85: auto-match, log as fuzzy in cache.
 *   4. If confidence < 0.85: flag as unmatched (write cache row with source=unmatched).
 *
 * Algorithm: Jaccard similarity over tokens (lowercased, alphanumeric, 2+ chars)
 * weighted by source (canonical name 1.0 > alt name 0.95 > jotform name 0.9 > parent fallback 0.7).
 * Bonus for exact prefix and substring match.
 */

const FUZZY_THRESHOLD = 0.85;

/**
 * Match a raw breed string. Side-effect: updates Breed Match Cache.
 * Returns { matched_breed_id, matched_breed_name, confidence, source, suggestions }.
 *
 * `suggestions` is the top-3 alternatives (used for unmatched fallback in today.json).
 */
function matchBreed_(rawBreed) {
  const raw = String(rawBreed ?? "").trim();
  if (!raw) return { matched_breed_id: null, confidence: 0, source: "unmatched", suggestions: [] };

  const cacheSheet = getDb_().getSheetByName("Breed Match Cache");
  const cacheRead = readSheet_("Breed Match Cache");

  // Step 1: exact cache hit (case-insensitive)
  const lowered = raw.toLowerCase();
  const cachedExact = cacheRead.rows.find((r) => String(r.raw_breed ?? "").toLowerCase() === lowered);
  if (cachedExact && cachedExact.matched_breed_id && cachedExact.source !== "unmatched") {
    // Bump hit_count + last_seen
    writeRow_(cacheSheet, cacheRead.headers, cachedExact._rowIndex, {
      last_seen: nowIso_(),
      hit_count: Number(cachedExact.hit_count ?? 0) + 1,
    });
    return {
      matched_breed_id: cachedExact.matched_breed_id,
      matched_breed_name: cachedExact.matched_breed_name,
      confidence: Number(cachedExact.confidence ?? 1.0),
      source: cachedExact.source,
      suggestions: [],
    };
  }

  // Step 2: token-based fuzzy match
  const { rows: breeds } = readSheet_("Breeds");
  const candidates = scoreCandidates_(raw, breeds);

  const top = candidates[0];
  if (top && top.score >= FUZZY_THRESHOLD) {
    // Auto-match. Cache it.
    upsertCacheRow_(cacheSheet, cacheRead, raw, {
      matched_breed_id: top.breed_id,
      matched_breed_name: top.breed_name,
      confidence: top.score,
      source: "fuzzy",
    });
    return {
      matched_breed_id: top.breed_id,
      matched_breed_name: top.breed_name,
      confidence: top.score,
      source: "fuzzy",
      suggestions: candidates.slice(1, 4).map((c) => ({ breed_id: c.breed_id, breed_name: c.breed_name, score: c.score })),
    };
  }

  // Step 3: unmatched. Cache as such so we don't re-score every time.
  upsertCacheRow_(cacheSheet, cacheRead, raw, {
    matched_breed_id: null,
    matched_breed_name: null,
    confidence: top?.score ?? 0,
    source: "unmatched",
  });

  // Also log to Backlog Signals
  logBacklogSignal_(raw, "booking");

  return {
    matched_breed_id: null,
    matched_breed_name: null,
    confidence: top?.score ?? 0,
    source: "unmatched",
    suggestions: candidates.slice(0, 3).map((c) => ({ breed_id: c.breed_id, breed_name: c.breed_name, score: c.score })),
  };
}

function scoreCandidates_(raw, breeds) {
  const queryTokens = tokenise_(raw);
  if (queryTokens.size === 0) return [];

  const results = [];
  for (const b of breeds) {
    if (b.status === "archived") continue;
    let bestScore = 0;
    let bestSource = "name";
    const sources = [
      { name: "name", weight: 1.0, value: b.breed_name },
      ...parseJsonArray_(b.alternative_names).map((v) => ({ name: "alt_name", weight: 0.95, value: v })),
      ...parseJsonArray_(b.common_jotform_names).map((v) => ({ name: "jotform_name", weight: 0.9, value: v })),
    ];
    for (const s of sources) {
      const score = stringScore_(queryTokens, raw.toLowerCase(), String(s.value ?? ""), s.weight);
      if (score > bestScore) { bestScore = score; bestSource = s.name; }
    }
    if (bestScore > 0.3) {
      results.push({
        breed_id: b.breed_id,
        breed_name: b.breed_name,
        score: bestScore,
        source: bestSource,
      });
    }
  }
  results.sort((a, b) => b.score - a.score);
  return results;
}

/**
 * Score a candidate string against the query.
 * Combines:
 *   - Jaccard similarity over tokens (50%)
 *   - Substring match boost (30%)
 *   - Prefix match boost (20%)
 * Multiplied by source weight.
 */
function stringScore_(queryTokens, queryLower, candidate, weight) {
  if (!candidate) return 0;
  const candLower = String(candidate).toLowerCase();
  const candTokens = tokenise_(candLower);
  if (candTokens.size === 0) return 0;

  // Jaccard similarity
  const intersection = new Set([...queryTokens].filter((t) => candTokens.has(t)));
  const union = new Set([...queryTokens, ...candTokens]);
  const jaccard = intersection.size / union.size;

  // Substring + prefix boosts
  const containsBoost = candLower.includes(queryLower) || queryLower.includes(candLower) ? 1.0 : 0;
  const prefixBoost = candLower.startsWith(queryLower) || queryLower.startsWith(candLower) ? 1.0 : 0;

  // Exact equality is a perfect match
  if (candLower === queryLower) return 1.0 * weight;

  const combined = (jaccard * 0.5) + (containsBoost * 0.3) + (prefixBoost * 0.2);
  return combined * weight;
}

function tokenise_(s) {
  return new Set(
    String(s ?? "").toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 2)
  );
}

function upsertCacheRow_(sheet, read, raw, fields) {
  const lowered = raw.toLowerCase();
  const existing = read.rows.find((r) => String(r.raw_breed ?? "").toLowerCase() === lowered);
  if (existing) {
    writeRow_(sheet, read.headers, existing._rowIndex, {
      ...fields,
      last_seen: nowIso_(),
      hit_count: Number(existing.hit_count ?? 0) + 1,
    });
  } else {
    appendRow_(sheet, read.headers, {
      cache_id: nextId_("cache"),
      raw_breed: raw,
      ...fields,
      first_seen: nowIso_(),
      last_seen: nowIso_(),
      hit_count: 1,
    });
  }
}

function logBacklogSignal_(rawBreed, source) {
  try {
    const sheet = getDb_().getSheetByName("Backlog Signals");
    if (!sheet) return;
    const read = readSheet_("Backlog Signals");
    const lowered = String(rawBreed).toLowerCase();
    const existing = read.rows.find((r) =>
      String(r.raw_breed ?? "").toLowerCase() === lowered && r.current_status !== "done");
    if (existing) {
      writeRow_(sheet, read.headers, existing._rowIndex, {
        last_seen: nowIso_(),
        search_count: Number(existing.search_count ?? 0) + 1,
      });
    } else {
      appendRow_(sheet, read.headers, {
        backlog_id: nextId_("backlog"),
        raw_breed: rawBreed,
        first_seen: nowIso_(),
        last_seen: nowIso_(),
        search_count: 1,
        current_status: "open",
        priority: 1,
        source,
        resolved_breed_id: "",
      });
    }
  } catch (err) {
    Logger.log(`[matcher] backlog signal failed: ${err}`);
  }
}

// ─── op: log_backlog_hit ────────────────────────────────────────────
//
// Called by TV's manual-search-miss flow (no auth — public endpoint).
// To be wired in Code.gs — currently lives here for cohesion.

function op_log_backlog_hit(body) {
  const rawBreed = String(body.raw_breed ?? "").trim();
  const source = String(body.source ?? "manual_search");
  if (!rawBreed) throw apiError_("VALIDATION_FAILED", "raw_breed required");
  logBacklogSignal_(rawBreed, source);
  return { ok: true };
}
