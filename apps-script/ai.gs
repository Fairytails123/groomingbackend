/**
 * ai.gs — Stage 3 Phase 2 OpenAI integration.
 *
 * One client wrapper (callOpenAI_) used by:
 *   - op_extract_sections      (gpt-4o-mini, WF-06 prompt, structured JSON)
 *   - op_run_vision_pass_page  (gpt-4o, WF-08 prompt, image input)
 *   - op_list_pending_headings + op_decide_heading (no OpenAI; sheet ops)
 *
 * Cost guard: assertCostCapNotExceeded_() reads today's AI Call Log rows,
 * sums cost_usd, converts to GBP, throws QUOTA_EXCEEDED if over the cap.
 * Default cap £5/day — Kamal can override via Script Property
 * OPENAI_DAILY_CAP_GBP. USD→GBP conversion is a fixed conservative
 * 0.85 unless OPENAI_USD_TO_GBP is set.
 *
 * The two prompts (WF06_SYSTEM_PROMPT, WF08_SYSTEM_PROMPT) are quoted
 * verbatim from docs/workflows.md §AI prompts. Keep in sync if either
 * is edited there.
 */

// ─── Constants ──────────────────────────────────────────────────────

const OPENAI_MODELS = {
  // Cheap structurer for pdf.js raw OCR. Text-only — vision quality
  // doesn't matter here.
  extract: "gpt-4o-mini",
  // Vision quality matters: real Adobe Scan pages have handwritten
  // annotations and tiny margin blade numbers that printed-text OCR
  // misses entirely. Use the flagship multimodal model.
  vision:  "gpt-5",
};

// USD per 1M tokens. Snapshot from OpenAI pricing as of 2026-05; verify
// at https://openai.com/api/pricing/ if you change the model. Unknown
// models return 0 from estimateCostUsd_, which silently disables the
// daily cost cap — so always add a row here when you switch.
const OPENAI_RATES_USD_PER_M = {
  "gpt-4o-mini":   { input: 0.15, output: 0.60 },
  "gpt-4o":        { input: 2.50, output: 10.00 },
  "gpt-4.1":       { input: 2.00, output: 8.00 },
  "gpt-4.1-mini":  { input: 0.40, output: 1.60 },
  "gpt-4.1-nano":  { input: 0.10, output: 0.40 },
  "gpt-5":         { input: 1.25, output: 10.00 },
  "gpt-5-mini":    { input: 0.25, output: 2.00 },
  "gpt-5-nano":    { input: 0.05, output: 0.40 },
};

const OPENAI_DEFAULT_CAP_GBP = 5.0;
const OPENAI_DEFAULT_USD_TO_GBP = 0.85;
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

// WF-06 — structures raw OCR text into the five core sections + extras.
// Keep this string in sync with docs/workflows.md §AI prompts.
const WF06_SYSTEM_PROMPT = [
  'You are a grooming-knowledge structurer for a UK dog grooming salon. Your job is to take raw OCR text from a scanned grooming guide and return a structured JSON document.',
  '',
  'The output MUST conform exactly to the schema given. Do not add extra fields. Do not include markdown or commentary outside the JSON.',
  '',
  'The five core sections, in order, are:',
  '1. "Body"',
  '2. "Throat and chest"',
  '3. "Carriage and tail end"',
  '4. "Legs and feet"',
  '5. "Head/ears/brows"',
  '',
  'If a core section has no content in the source, return an empty string for that section\'s text — do not omit the section.',
  '',
  'If you find content that doesn\'t fit a core section but is clearly a substantive heading (e.g. "Topknot", "Beard care", "Coat texture"), return it under "extra_headings" with a one-sentence reason for inclusion. Do not invent extra headings — only surface ones explicitly present.',
  '',
  'Extract every blade number you see (e.g. #7F, #10, 4F, "blade 7"). Normalise to "#7F" style. Do not fabricate.',
  '',
  'Extract any safety, breed-specific, or owner-preference notes into "important_notes".',
  '',
  'For each piece of extracted content, include a confidence score (0.0-1.0). Below 0.6 means uncertain — surface for human review.',
  '',
  'Output schema:',
  '{',
  '  "sections": [',
  '    { "name": "Body", "text": "string", "blade_numbers": ["#7F"], "confidence": 0.0 }',
  '  ],',
  '  "extra_headings": [',
  '    { "heading": "Topknot", "text": "string", "reason": "Substantial paragraph at top of page 3.", "confidence": 0.0 }',
  '  ],',
  '  "important_notes": "string",',
  '  "overall_confidence": 0.0',
  '}',
].join("\n");

// WF-08 — vision pass over a single page render. Returns ONLY content the
// printed-text OCR would have missed (handwriting, margin annotations,
// tiny diagram blade numbers).
const WF08_SYSTEM_PROMPT = [
  'You are inspecting a scanned page of a dog grooming guide. The page contains printed body text plus, often, handwritten annotations near small diagrams (e.g. "use #4F here", arrows pointing to specific body parts, breed-specific tweaks scribbled by a senior groomer).',
  '',
  'Your job is to return ONLY content that printed-text OCR would have missed. That is:',
  '- Handwritten annotations',
  '- Tiny blade numbers in margins or on diagrams',
  '- Notes hand-drawn near diagrams',
  '',
  'Do NOT re-extract printed paragraphs — the OCR has those.',
  'Do NOT describe diagrams visually — only transcribe text/numbers in/near them.',
  'Do NOT invent. If a page has no handwriting and no margin annotations, return an empty list.',
  '',
  'For each finding, include:',
  '- "type": "blade" | "handwritten_note" | "annotation"',
  '- "text": the literal transcription',
  '- "position": one of "top", "middle", "bottom", "margin-left", "margin-right", "near-diagram"',
  '- "confidence": 0.0-1.0',
  '',
  'Output schema:',
  '{ "findings": [',
  '  { "type": "blade", "text": "#4F", "position": "near-diagram", "confidence": 0.8 }',
  '] }',
].join("\n");

// ─── callOpenAI_ ────────────────────────────────────────────────────
//
// One entry point so logging + cost capture happens unconditionally.
// Pass user_text for plain prompts OR user_content for multimodal
// (e.g. [{type:"text",...},{type:"image_url",...}]).
//
// Returns the parsed JSON object from message.content. Throws
// apiError_("OPENAI_FAILED", ...) on HTTP error or unparseable response.

function callOpenAI_(opts) {
  const {
    model,
    system,
    user_text,
    user_content,
    response_format = { type: "json_object" },
    max_tokens = 4096,
    temperature = 0,
    profile_id = "",
    source = "ai_call",
  } = opts;

  const apiKey = PropertiesService.getScriptProperties().getProperty("OPENAI_API_KEY");
  if (!apiKey) throw apiError_("INTERNAL", "OPENAI_API_KEY not configured in Script Properties");

  const messages = [
    { role: "system", content: system },
    { role: "user", content: user_content ?? user_text ?? "" },
  ];

  // Reasoning-class models (gpt-5*, o1*, o3*) use the newer parameter names
  // and reject custom `temperature`. Older chat models (gpt-4*, gpt-4o*,
  // gpt-3.5*) still take `max_tokens` + `temperature`. Detect by model id
  // prefix and shape the payload accordingly. Bug found 2026-05-04 during
  // Phase 2 smoke test: vision calls to gpt-5 returned HTTP 400
  // "Unsupported parameter: 'max_tokens' is not supported with this model.
  //  Use 'max_completion_tokens' instead."
  const usesNewParams = /^(gpt-5|o1|o3)/i.test(String(model));

  const payload = {
    model,
    messages,
    response_format,
  };
  if (usesNewParams) {
    payload.max_completion_tokens = max_tokens;
    // Vision/extract here is transcription-grade; keep reasoning minimal so the
    // budget goes to the JSON findings, not internal deliberation.
    payload.reasoning_effort = "low";
    // Reasoning models reject any non-default temperature — leave unset.
  } else {
    payload.max_tokens = max_tokens;
    payload.temperature = temperature;
  }

  const startedAt = Date.now();
  let response;
  try {
    response = UrlFetchApp.fetch(OPENAI_API_URL, {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + apiKey },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
  } catch (err) {
    const latency = Date.now() - startedAt;
    logAiCall_({
      profile_id, source, model,
      prompt_tokens: 0, completion_tokens: 0, cost_usd: 0,
      latency_ms: latency, success: false, error_code: "FETCH_FAILED",
    });
    logOperationalAlert_("error", source, `OpenAI fetch failed: ${err}`, { profile_id, model });
    throw apiError_("OPENAI_FAILED", `OpenAI request failed: ${err}`);
  }

  const latency = Date.now() - startedAt;
  const code = response.getResponseCode();
  const text = response.getContentText();

  if (code < 200 || code >= 300) {
    logAiCall_({
      profile_id, source, model,
      prompt_tokens: 0, completion_tokens: 0, cost_usd: 0,
      latency_ms: latency, success: false, error_code: `HTTP_${code}`,
    });
    logOperationalAlert_("error", source, `OpenAI HTTP ${code}`, {
      profile_id, model, body: text.slice(0, 1000),
    });
    throw apiError_("OPENAI_FAILED", `OpenAI HTTP ${code}: ${text.slice(0, 200)}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    logAiCall_({
      profile_id, source, model,
      prompt_tokens: 0, completion_tokens: 0, cost_usd: 0,
      latency_ms: latency, success: false, error_code: "BAD_ENVELOPE",
    });
    throw apiError_("OPENAI_FAILED", `OpenAI returned non-JSON envelope`);
  }

  const usage = parsed.usage ?? {};
  const promptTokens = Number(usage.prompt_tokens ?? 0);
  const completionTokens = Number(usage.completion_tokens ?? 0);
  const costUsd = estimateCostUsd_(model, promptTokens, completionTokens);

  let content;
  try {
    content = JSON.parse(parsed.choices?.[0]?.message?.content ?? "{}");
  } catch (err) {
    logAiCall_({
      profile_id, source, model,
      prompt_tokens: promptTokens, completion_tokens: completionTokens, cost_usd: costUsd,
      latency_ms: latency, success: false, error_code: "BAD_CONTENT",
    });
    throw apiError_("OPENAI_FAILED", `OpenAI message.content was not valid JSON`);
  }

  logAiCall_({
    profile_id, source, model,
    prompt_tokens: promptTokens, completion_tokens: completionTokens, cost_usd: costUsd,
    latency_ms: latency, success: true,
  });

  return content;
}

// ─── Cost helpers ───────────────────────────────────────────────────

function estimateCostUsd_(model, promptTokens, completionTokens) {
  const rates = OPENAI_RATES_USD_PER_M[model];
  if (!rates) return 0;  // unknown model → don't fail, just don't bill
  const pIn = (Number(promptTokens) || 0) / 1e6;
  const pOut = (Number(completionTokens) || 0) / 1e6;
  return pIn * rates.input + pOut * rates.output;
}

function logAiCall_(row) {
  try {
    const sheet = getDb_().getSheetByName("AI Call Log");
    if (!sheet) return;  // sheet not created yet → skip rather than throw
    const headers = readSheet_("AI Call Log").headers;
    appendRow_(sheet, headers, {
      call_id: nextId_("ai_call"),
      profile_id: row.profile_id ?? "",
      source: row.source ?? "",
      model: row.model ?? "",
      prompt_tokens: row.prompt_tokens ?? 0,
      completion_tokens: row.completion_tokens ?? 0,
      cost_usd: Number(row.cost_usd ?? 0).toFixed(6),
      latency_ms: row.latency_ms ?? 0,
      success: row.success ? "TRUE" : "FALSE",
      error_code: row.error_code ?? "",
      created_at: nowIso_(),
    });
  } catch (err) {
    Logger.log(`[ai] could not log call: ${err}`);
  }
}

// Throws QUOTA_EXCEEDED if today's spend (UTC day) is at or above the cap.
// Logs an Operational Alerts row at most once per UTC day.
function assertCostCapNotExceeded_() {
  const props = PropertiesService.getScriptProperties();
  const cap = Number(props.getProperty("OPENAI_DAILY_CAP_GBP") ?? OPENAI_DEFAULT_CAP_GBP);
  const fxRate = Number(props.getProperty("OPENAI_USD_TO_GBP") ?? OPENAI_DEFAULT_USD_TO_GBP);
  if (!isFinite(cap) || cap <= 0) return;  // disabled

  const todayStartIso = todayStartUtcIso_();
  const { rows } = readSheet_("AI Call Log");
  let totalUsd = 0;
  for (const r of rows) {
    if (toIso_(r.created_at) >= todayStartIso) {
      totalUsd += Number(r.cost_usd ?? 0);
    }
  }
  const totalGbp = totalUsd * fxRate;
  if (totalGbp >= cap) {
    // De-dupe the alert: at most one ai_quota error per UTC day.
    const { rows: alerts } = readSheet_("Operational Alerts");
    const alreadyAlerted = alerts.some((a) =>
      a.source === "ai_quota" &&
      toIso_(a.created_at) >= todayStartIso
    );
    if (!alreadyAlerted) {
      logOperationalAlert_("error", "ai_quota",
        `Daily AI cap of £${cap.toFixed(2)} reached — current £${totalGbp.toFixed(2)}`,
        { cap_gbp: cap, total_gbp: totalGbp, total_usd: totalUsd, fx_rate: fxRate });
    }
    throw apiError_("QUOTA_EXCEEDED",
      `Daily AI cap of £${cap.toFixed(2)} reached — try again after midnight UTC, or raise OPENAI_DAILY_CAP_GBP`);
  }
}

function todayStartUtcIso_() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

// ─── op: extract_sections ───────────────────────────────────────────
//
// Browser POSTs raw OCR text from pdf.js → GPT-4o-mini structures it into
// the 5 core sections + extras + blade numbers + important notes, with
// per-section confidence. We UPSERT the 5 core rows in Sheet 3 (key:
// profile_id + section_name) so re-running on the same PDF doesn't
// duplicate. Extras land as pending rows in Sheet 6 for human approval.

function op_extract_sections(body) {
  const profileId = requireString_(body.profile_id, "profile_id");
  const rawText = requireString_(body.raw_text, "raw_text", { minLength: 50, maxLength: 1000000 });

  return withProfileLock_(profileId, 60000, () => {
    const { rows: profiles } = readSheet_("Groom Profiles");
    const profile = profiles.find((p) => p.profile_id === profileId);
    if (!profile) throw apiError_("NOT_FOUND", `profile '${profileId}' not found`);

    assertCostCapNotExceeded_();

    const result = callOpenAI_({
      model: OPENAI_MODELS.extract,
      system: WF06_SYSTEM_PROMPT,
      user_text: `<RAW_TEXT>\n${rawText}\n</RAW_TEXT>`,
      response_format: { type: "json_object" },
      max_tokens: 4096,
      profile_id: profileId,
      source: "extract_sections",
    });

    const aiSections = Array.isArray(result.sections) ? result.sections : [];
    const aiExtras = Array.isArray(result.extra_headings) ? result.extra_headings : [];
    const importantNotes = String(result.important_notes ?? "");
    const overallConfidence = Number(result.overall_confidence ?? 0);

    // Index AI sections by name for O(1) lookup.
    const bySectionName = {};
    for (const s of aiSections) {
      const n = String(s?.name ?? "").trim();
      if (n) bySectionName[n] = s;
    }

    // Upsert the 5 core rows in Sheet 3.
    const knowledgeSheet = getDb_().getSheetByName("Groom Knowledge");
    const knowledgeRead = readSheet_("Groom Knowledge");
    const profileRows = knowledgeRead.rows.filter((r) => r.profile_id === profileId);
    const byName = Object.fromEntries(profileRows.map((r) => [r.section_name, r]));

    let sectionsUpdated = 0;
    CORE_SECTIONS.forEach((sectionName, idx) => {
      const ai = bySectionName[sectionName];
      const text = String(ai?.text ?? "");
      const bladeNumbers = Array.isArray(ai?.blade_numbers) ? ai.blade_numbers : [];
      const confidence = ai?.confidence == null ? "" : Number(ai.confidence);
      const patch = {
        section_text: text,
        blade_numbers: JSON.stringify(bladeNumbers),
        important_notes: idx === 0 ? importantNotes : "",
        ai_confidence: confidence,
        updated_at: nowIso_(),
      };

      const existing = byName[sectionName];
      if (existing) {
        writeRow_(knowledgeSheet, knowledgeRead.headers, existing._rowIndex, patch);
      } else {
        // Defensive — op_create_profile always seeds the 5 rows, but a
        // hand-edited sheet could lose one.
        appendRow_(knowledgeSheet, knowledgeRead.headers, {
          section_id: nextId_("section"),
          profile_id: profileId,
          section_name: sectionName,
          section_order: idx + 1,
          ...patch,
          approved: "FALSE",
          created_at: nowIso_(),
        });
      }
      sectionsUpdated++;
    });

    // Insert pending Sheet 6 rows for new extra headings.
    // De-dupe against existing rows by (profile_id, suggested_heading) regardless
    // of decision state — re-running shouldn't re-suggest already-approved/ignored ones.
    const approvalsSheet = getDb_().getSheetByName("Extra Heading Approvals");
    const approvalsRead = readSheet_("Extra Heading Approvals");
    const existingHeadingsLower = new Set(
      approvalsRead.rows
        .filter((r) => r.profile_id === profileId)
        .map((r) => String(r.suggested_heading ?? "").toLowerCase())
    );

    let extrasPending = 0;
    for (const eh of aiExtras) {
      const heading = String(eh?.heading ?? "").trim();
      if (!heading) continue;
      if (existingHeadingsLower.has(heading.toLowerCase())) continue;
      appendRow_(approvalsSheet, approvalsRead.headers, {
        approval_id: nextId_("approval"),
        profile_id: profileId,
        suggested_heading: heading,
        suggested_text: String(eh?.text ?? ""),
        ai_reason: String(eh?.reason ?? ""),
        telegram_message_id: "",
        user_decision: "pending",
        final_status: "",
        decided_at: "",
        created_at: nowIso_(),
      });
      extrasPending++;
    }

    // Clear any stale error_message from a previous failed run.
    if (profile.error_message) {
      const profilesSheet = getDb_().getSheetByName("Groom Profiles");
      const profilesHeaders = readSheet_("Groom Profiles").headers;
      writeRow_(profilesSheet, profilesHeaders, profile._rowIndex, {
        error_message: "",
        updated_at: nowIso_(),
      });
    }

    return {
      profile_id: profileId,
      sections_updated: sectionsUpdated,
      extra_headings_pending: extrasPending,
      overall_confidence: overallConfidence,
    };
  });
}

// ─── op: run_vision_pass_page ───────────────────────────────────────
//
// Per-page vision call. Browser invokes one call per render id sequentially,
// catches per-page errors, and continues with the next page so a single
// failure doesn't block the whole intake. Findings are written as a separate
// "Vision findings — page N" section row in Sheet 3 (preserving provenance);
// any blade numbers found are also merged into the Body row's blade list so
// they show in the TV's blade box.

function op_run_vision_pass_page(body) {
  const profileId = requireString_(body.profile_id, "profile_id");
  const renderId = requireString_(body.page_render_id, "page_render_id");

  return withProfileLock_(profileId, 60000, () => {
    const { rows: profiles } = readSheet_("Groom Profiles");
    const profile = profiles.find((p) => p.profile_id === profileId);
    if (!profile) throw apiError_("NOT_FOUND", `profile '${profileId}' not found`);

    const { rows: renders } = readSheet_("Page Renders");
    const render = renders.find((r) => r.page_render_id === renderId);
    if (!render) throw apiError_("NOT_FOUND", `page render '${renderId}' not found`);
    if (render.profile_id !== profileId) {
      throw apiError_("VALIDATION_FAILED", "page render does not belong to this profile");
    }

    assertCostCapNotExceeded_();

    const pageIndex = Number(render.page_index ?? 0);
    const driveFileId = String(render.drive_file_id ?? "");
    if (!driveFileId) throw apiError_("VALIDATION_FAILED", "page render has no drive_file_id");

    // Read JPEG bytes and turn into a data URL for the OpenAI vision call.
    const blob = DriveApp.getFileById(driveFileId).getBlob();
    const dataUrl = `data:${blob.getContentType()};base64,${Utilities.base64Encode(blob.getBytes())}`;

    const result = callOpenAI_({
      model: OPENAI_MODELS.vision,
      system: WF08_SYSTEM_PROMPT,
      user_content: [
        // Must include the word "json" in messages when response_format is json_object —
        // OpenAI rejects with a 400 otherwise. Bug found 2026-05-04 smoke test.
        { type: "text", text: `Return JSON findings for page ${pageIndex} of the source PDF.` },
        { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
      ],
      response_format: { type: "json_object" },
      max_tokens: 8192,  // gpt-5 reasoning eats this budget; need headroom for the JSON findings
      profile_id: profileId,
      source: "vision_page",
    });

    const findings = Array.isArray(result.findings) ? result.findings : [];
    if (findings.length === 0) {
      return {
        page_render_id: renderId,
        page_index: pageIndex,
        findings_count: 0,
        blade_numbers_added: 0,
        section_id: null,
      };
    }

    // Build the human-readable section_text + accumulate blade numbers.
    const lines = findings.map((f) => {
      const type = String(f?.type ?? "annotation");
      const text = String(f?.text ?? "");
      const position = String(f?.position ?? "");
      const conf = f?.confidence == null ? "" : ` (conf ${Number(f.confidence).toFixed(2)})`;
      return `[${type}] @${position}: ${text}${conf}`;
    });
    const sectionText = lines.join("\n");

    const bladeFindings = findings
      .filter((f) => String(f?.type ?? "") === "blade")
      .map((f) => String(f?.text ?? "").trim())
      .filter(Boolean);

    const confidenceVals = findings
      .map((f) => (f?.confidence == null ? null : Number(f.confidence)))
      .filter((v) => v != null && isFinite(v));
    const avgConfidence = confidenceVals.length
      ? confidenceVals.reduce((a, b) => a + b, 0) / confidenceVals.length
      : "";

    const sectionName = `Vision findings — page ${pageIndex}`;
    const sectionOrder = 100 + pageIndex;  // stable across re-runs; sits after the 5 core sections.

    const knowledgeSheet = getDb_().getSheetByName("Groom Knowledge");
    const knowledgeRead = readSheet_("Groom Knowledge");
    const profileRows = knowledgeRead.rows.filter((r) => r.profile_id === profileId);
    const existingVision = profileRows.find((r) => r.section_name === sectionName);

    let sectionId;
    if (existingVision) {
      sectionId = existingVision.section_id;
      writeRow_(knowledgeSheet, knowledgeRead.headers, existingVision._rowIndex, {
        section_text: sectionText,
        blade_numbers: JSON.stringify(bladeFindings),
        ai_confidence: avgConfidence,
        section_order: sectionOrder,
        updated_at: nowIso_(),
      });
    } else {
      sectionId = nextId_("section");
      appendRow_(knowledgeSheet, knowledgeRead.headers, {
        section_id: sectionId,
        profile_id: profileId,
        section_name: sectionName,
        section_order: sectionOrder,
        section_text: sectionText,
        blade_numbers: JSON.stringify(bladeFindings),
        important_notes: "",
        ai_confidence: avgConfidence,
        approved: "FALSE",
        created_at: nowIso_(),
        updated_at: nowIso_(),
      });
    }

    // Merge blade findings into the Body row so the TV blade box catches them.
    let bladeNumbersAdded = 0;
    if (bladeFindings.length) {
      // Re-read Sheet 3 since we may have just appended (stale row indices).
      const fresh = readSheet_("Groom Knowledge");
      const bodyRow = fresh.rows.find((r) => r.profile_id === profileId && r.section_name === "Body");
      if (bodyRow) {
        const existing = parseJsonArray_(bodyRow.blade_numbers).map(String);
        const merged = [...existing];
        for (const b of bladeFindings) {
          if (!merged.some((e) => e.toLowerCase() === b.toLowerCase())) {
            merged.push(b);
            bladeNumbersAdded++;
          }
        }
        if (bladeNumbersAdded > 0) {
          writeRow_(knowledgeSheet, fresh.headers, bodyRow._rowIndex, {
            blade_numbers: JSON.stringify(merged),
            updated_at: nowIso_(),
          });
        }
      }
    }

    return {
      page_render_id: renderId,
      page_index: pageIndex,
      findings_count: findings.length,
      blade_numbers_added: bladeNumbersAdded,
      section_id: sectionId,
    };
  });
}

// ─── op: list_pending_headings ──────────────────────────────────────
//
// Returns the Sheet 6 rows still awaiting decision for a profile, used
// by the profile editor's IMAGES tab to surface AI-suggested extra
// headings inline.

function op_list_pending_headings(body) {
  const profileId = requireString_(body.profile_id, "profile_id");
  const { rows } = readSheet_("Extra Heading Approvals");
  const pending = rows
    .filter((r) => r.profile_id === profileId && r.user_decision === "pending")
    .map((r) => ({
      approval_id: r.approval_id,
      suggested_heading: r.suggested_heading,
      suggested_text: r.suggested_text ?? "",
      ai_reason: r.ai_reason ?? "",
      created_at: toIso_(r.created_at),
    }))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  return { pending };
}

// ─── op: decide_heading ─────────────────────────────────────────────
//
// User taps Approve / Edit & Approve / Ignore on a pending row. On approve
// (or edit_and_approve), we append the new heading to Sheet 3 as a section
// after the 5 core rows and any existing extras. On ignore, just patch
// the approvals row.
//
// Idempotent — assertion that the row is still 'pending' makes a double
// decide impossible.

const HEADING_DECISIONS = ["approve", "ignore", "edit_and_approve"];

function op_decide_heading(body) {
  const approvalId = requireString_(body.approval_id, "approval_id");
  const decision = requireEnum_(body.decision, "decision", HEADING_DECISIONS);

  const approvalsSheet = getDb_().getSheetByName("Extra Heading Approvals");
  const { headers: approvalsHeaders, rows: approvalsRows } = readSheet_("Extra Heading Approvals");
  const row = approvalsRows.find((r) => r.approval_id === approvalId);
  if (!row) throw apiError_("NOT_FOUND", `approval '${approvalId}' not found`);
  if (row.user_decision !== "pending") {
    throw apiError_("CONFLICT", `approval '${approvalId}' already decided as '${row.user_decision}'`);
  }
  const profileId = String(row.profile_id ?? "");
  if (!profileId) throw apiError_("INTERNAL", "approval row missing profile_id");

  return withProfileLock_(profileId, 30000, () => {
    const finalHeading = decision === "edit_and_approve"
      ? requireString_(body.edited_heading, "edited_heading", { maxLength: 200 })
      : String(row.suggested_heading ?? "");
    const finalText = decision === "edit_and_approve"
      ? String(body.edited_text ?? row.suggested_text ?? "")
      : String(row.suggested_text ?? "");

    let createdSectionId = null;
    if (decision === "approve" || decision === "edit_and_approve") {
      // Append a new section in Sheet 3 after the highest existing order.
      const knowledgeSheet = getDb_().getSheetByName("Groom Knowledge");
      const knowledgeRead = readSheet_("Groom Knowledge");
      const profileRows = knowledgeRead.rows.filter((r) => r.profile_id === profileId);
      const maxOrder = profileRows.reduce((m, r) => Math.max(m, Number(r.section_order ?? 0)), 0);
      createdSectionId = nextId_("section");
      appendRow_(knowledgeSheet, knowledgeRead.headers, {
        section_id: createdSectionId,
        profile_id: profileId,
        section_name: finalHeading,
        section_order: maxOrder + 1,
        section_text: finalText,
        blade_numbers: "[]",
        important_notes: "",
        ai_confidence: 0.7,
        approved: "FALSE",
        created_at: nowIso_(),
        updated_at: nowIso_(),
      });
    }

    const finalStatus = decision === "ignore" ? "ignored" : "approved";
    const patch = {
      user_decision: decision,
      final_status: finalStatus,
      decided_at: nowIso_(),
    };
    if (decision === "edit_and_approve") {
      patch.suggested_heading = finalHeading;
      patch.suggested_text = finalText;
    }
    writeRow_(approvalsSheet, approvalsHeaders, row._rowIndex, patch);

    return {
      approval_id: approvalId,
      final_status: finalStatus,
      section_id: createdSectionId,
    };
  });
}
