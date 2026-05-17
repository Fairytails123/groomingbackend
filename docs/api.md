# Apps Script API Reference

Single Web App URL. All requests are POST with a JSON body that includes an `op` field. The image proxy is the one exception: `doGet` on a separate Web App deployment.

Distilled from the data + API design agent output (2026-05-03 design pass) and the v3.6 spec §6.11.

---

## Conventions

**Request envelope:**
```json
{ "op": "string", "auth_token": "...", "expected_version": 7, ... }
```

**Response envelope:**
```json
{ "ok": true,  "data": { ... }, "request_id": "REQ-..." }
{ "ok": false, "error": { "code": "STRING", "message": "..." }, "request_id": "REQ-..." }
```

**Error codes:** `UNAUTHORIZED`, `NOT_FOUND`, `VALIDATION_FAILED`, `CONFLICT`, `QUOTA_EXCEEDED`, `GITHUB_FAILED`, `OPENAI_FAILED`, `TIMEOUT`, `INTERNAL`.

**Concurrency:** Mutating ops accept `expected_version` (int). Server compares against `Groom Profiles.current_version`; mismatch returns `CONFLICT`. This guards two-tabs-same-user accidents.

**Async work:** Stage 3 Phase 2 is fully synchronous — the browser orchestrates the PDF intake sequence and each op completes in seconds. The earlier `Jobs` sheet + 1-minute trigger pattern is reserved for future server-driven work (e.g. WF-04 Telegram intake) and the `op: "job_status"` stub remains for that.

**Auth in body, not header:** Apps Script Web Apps strip non-standard headers. The token goes in the JSON body field `auth_token`.

---

## Operations

### Auth

#### `op: "login"`
**Request:** `{ op: "login", password: "..." }`
**Response:** `{ token, expires_at }` — token is `base64url(payload).base64url(HMAC_SHA256(SESSION_SECRET, payload))` with `payload = { iat, exp, scope: "admin" }` and `exp = iat + 12h`.
**Errors:** `UNAUTHORIZED` (bad password), `QUOTA_EXCEEDED` (rate limit — 50 fails/day).

#### `op: "logout"`
**Request:** `{ op: "logout", auth_token }`
**Response:** `{ ok: true, data: {} }` — token added to a small denylist (optional; can also just rely on TTL).

#### `op: "ping"`
**Request:** `{ op: "ping" }` (no auth required)
**Response:** `{ ok: true, server_time: "...", build: "..." }` — health check.

### Breeds

#### `op: "list_breeds"`
**Request:** `{ op: "list_breeds", auth_token, filter?: { status, breed_type, has_published_profile, search } }`
**Response:**
```json
{ "breeds": [
    { "breed_id":"BRD-001", "breed_name":"Cavapoo", "slug":"cavapoo",
      "breed_type":"cross", "profile_count":3, "published_count":2,
      "has_pet_groom":true, "last_updated":"2026-04-30T10:14:00+01:00" }
  ] }
```

#### `op: "search_breeds"`
**Request:** `{ op: "search_breeds", auth_token, query, limit?: 10 }`
**Response:** `{ matches: [ { breed_id, breed_name, score, reason: "alt_name|name|jotform_name" } ] }` — used by library typeahead and Telegram "did you mean" flows.

#### `op: "override_breed_match"`
**Request:** `{ op: "override_breed_match", auth_token, raw_breed, matched_breed_id }`
**Response:** `{ cache_id, hit_count }` — writes `Breed Match Cache` with `source = manual, confidence = 1.0`. If a `Backlog Signals` row exists for `raw_breed`, flips it to `current_status = done`.

### Profiles

#### `op: "get_breed_profile"`
**Request:** `{ op: "get_breed_profile", auth_token, profile_id }`
**Response:** Full bundle for the editor:
```json
{ "profile": { ... },
  "breed":   { ... },
  "sections": [ { ... } ],
  "images":   [ { ... } ],
  "page_renders": [ { "page_render_id":"PGR-001", "page_index":1, "url":"<proxy URL>", "width_px":2480, "height_px":3508 } ],
  "display_settings": { ... } }
```

#### `op: "save_profile"`
**Request:**
```json
{ "op":"save_profile", "auth_token", "profile_id", "expected_version":7,
  "patch": {
    "groom_type": "...",
    "default_profile": false,
    "sections": [ { "section_id":null|"SEC-...", "section_name":"Body", "section_order":1,
                    "section_text":"...", "blade_numbers":["#7F"], "important_notes":"..." } ],
    "display_settings": { ... }
  } }
```
**Behaviour:** atomic under `LockService`. Writes a `Version History` row with the previous-state snapshot, then upserts sections by `section_id` (insert if `null`), then bumps `current_version`. Returns the updated profile bundle.
**Errors:** `CONFLICT`, `VALIDATION_FAILED`.

#### `op: "list_groom_types"`
**Request:** `{ op: "list_groom_types", auth_token, breed_id? }`
**Response:** `{ groom_types: [ { name, slug, profile_count, published_count } ] }`

### Crops + page renders

#### `op: "save_crop"` (async)
**Request:**
```json
{ "op":"save_crop", "auth_token", "profile_id", "expected_version":7,
  "image": { "image_id": null|"IMG-014",
             "image_role":"main|front|back|head|supplementary",
             "source_page_render_id":"PGR-002",
             "crop_x":120, "crop_y":340, "crop_w":1800, "crop_h":2200,
             "display_position":0 } }
```
**Behaviour:** queues n8n WF-10 (Pillow crop). Returns `{ job_id, status: "queued" }`. Client polls `job_status`. Final result: `{ image: { ... full row ... }, drive_file_id, proxy_url }`.

#### `op: "delete_image"`
**Request:** `{ op: "delete_image", auth_token, image_id, expected_version }`
**Response:** `{ image_id, deleted: true, already_deleted?: true }`.
**Behaviour:** soft-delete. Marks the Images row `approved=FALSE`, `display_position=-1`. The publish flow filters by `approved=TRUE` so the image drops out of the next publish; previously-published versions remain intact because the Drive blob is kept (version history references the file ID). Wrapped in `withProfileLock_` to serialise against in-flight `save_crop` / `save_image_record` on the same profile. Idempotent — re-deleting an already-deleted row returns `already_deleted: true` without error.

#### `op: "list_page_renders"`
**Request:** `{ op: "list_page_renders", auth_token, profile_id }`
**Response:** `{ page_renders: [ { page_render_id, page_index, url, width_px, height_px } ] }`. `url` is the Apps Script image-proxy URL. Soft-deleted renders (`deleted_at` set) are filtered out.

#### `op: "delete_page_render"`
**Request:** `{ op: "delete_page_render", auth_token, page_render_id, profile_id? }`
**Response:** `{ page_render_id, deleted: true, cascaded_image_ids: [<image_id>, …], already_deleted?: true }`.
**Behaviour:** soft-delete the page render (stamps `Page Renders.deleted_at`), then cascade-soft-delete every Images row whose `source_page_render_id === page_render_id` and `approved === TRUE` (sets `approved=FALSE`, `display_position=-1`). Drive files are kept for both the page render and the cropped images. Wrapped in `withProfileLock_`. Idempotent — re-deleting returns `already_deleted: true` with an empty cascade list.

### PDF intake (Stage 3 Phase 2 — browser-orchestrated)

The browser drives the whole intake sequence: pdf.js renders pages locally, Apps Script saves each page render and the source PDF, then calls OpenAI directly for structuring + vision. No n8n hop.

#### `op: "upload_pdf"` (sync)
**Request:** `{ op: "upload_pdf", auth_token, profile_id, pdf_blob_b64, original_filename }`
**Behaviour:** writes the source PDF to Drive `…/01-original-pdf/`, sets `Groom Profiles.{source_pdf_drive_id, source_type:"pdf", status:"Processing", error_message:""}`. PDFs are kept private (no public sharing).
**Response:** `{ profile_id, drive_file_id, original_filename, status: "Processing" }`
**Errors:** `VALIDATION_FAILED`, `NOT_FOUND` (profile), `INTERNAL` (DRIVE_ROOT_ID missing).

#### `op: "get_source_pdf"` (sync)
**Request:** `{ op: "get_source_pdf", auth_token, profile_id }`
**Behaviour:** reads the stored source PDF back as base64 so the profile editor's "Re-extract sections" flow can re-run the same in-browser pipeline.
**Response:** `{ profile_id, drive_file_id, original_filename, pdf_blob_b64 }`
**Errors:** `NOT_FOUND` (no source PDF for this profile).

#### `op: "extract_sections"` (sync, calls OpenAI)
**Request:** `{ op: "extract_sections", auth_token, profile_id, raw_text }`
**Behaviour:** calls `gpt-4o-mini` with the WF-06 prompt (`docs/workflows.md`). Upserts the 5 core rows in `Groom Knowledge` by `(profile_id, section_name)`. Inserts each AI-suggested extra heading as a `pending` row in `Extra Heading Approvals`, de-duped by `(profile_id, suggested_heading)`. Logs the call to `AI Call Log` and clears any stale `error_message`.
**Response:** `{ profile_id, sections_updated, extra_headings_pending, overall_confidence }`
**Errors:** `VALIDATION_FAILED`, `NOT_FOUND`, `QUOTA_EXCEEDED`, `OPENAI_FAILED`.

#### `op: "run_vision_pass_page"` (sync, calls OpenAI)
**Request:** `{ op: "run_vision_pass_page", auth_token, profile_id, page_render_id }`
**Behaviour:** reads the page render JPEG from Drive, calls `gpt-4o` with the WF-08 prompt + image as data URL. Upserts a `Vision findings — page N` section row in `Groom Knowledge` (stable `section_order = 100 + page_index`). Merges any `type:"blade"` findings into the Body row's `blade_numbers` JSON array (de-duped).
**Response:** `{ page_render_id, page_index, findings_count, blade_numbers_added, section_id }`
**Errors:** `VALIDATION_FAILED`, `NOT_FOUND`, `QUOTA_EXCEEDED`, `OPENAI_FAILED`. Per-page failure does NOT abort intake — the browser catches and continues to the next page.

#### `op: "finalize_pdf_intake"` (sync)
**Request:** `{ op: "finalize_pdf_intake", auth_token, profile_id, partial_failures: [{ page_render_id, message }] }`
**Behaviour:** flips `Groom Profiles.status` from `Processing` to `Needs Review`. If `partial_failures` is non-empty, populates `error_message` with the count and writes a `warning` Operational Alerts row.
**Response:** `{ profile_id, status: "Needs Review", partial_failure_count }`
**Errors:** `CONFLICT` (profile not in `Processing`).

#### `op: "list_pending_headings"` (sync)
**Request:** `{ op: "list_pending_headings", auth_token, profile_id }`
**Response:** `{ pending: [{ approval_id, suggested_heading, suggested_text, ai_reason, created_at }] }`

#### `op: "decide_heading"` (sync)
**Request:** `{ op: "decide_heading", auth_token, approval_id, decision: "approve"|"ignore"|"edit_and_approve", edited_heading?, edited_text? }`
**Behaviour:** patches the `Extra Heading Approvals` row. On `approve` / `edit_and_approve`, also appends a new section row to `Groom Knowledge` with `section_order = max + 1` and the (possibly edited) heading + text.
**Response:** `{ approval_id, final_status: "approved"|"ignored", section_id }`
**Errors:** `CONFLICT` (already decided), `NOT_FOUND`.

### Image upload (legacy)

### Publish

#### `op: "publish_profile"` (sync ≤30s, else async)
**Request:** `{ op: "publish_profile", auth_token, profile_id, expected_version }`
**Behaviour:** runs the atomic publish (spec §6.10) — validate, stage, commit JSON + images to GitHub, write Sheets, enqueue session-pack rewrite.
**Response (success):** `{ profile_id, published_pack_url, today_json_refreshed: true }`
**Errors:** `CONFLICT`, `VALIDATION_FAILED` (e.g. `no_main_image`, `missing_core_section`), `GITHUB_FAILED`, `TIMEOUT`.

#### `op: "unpublish_profile"`
**Request:** `{ op: "unpublish_profile", auth_token, profile_id }`
**Behaviour:** removes JSON from GitHub Pages, flips status back to `Draft`, rewrites `today.json` if needed.

### Job control

#### `op: "job_status"`
**Request:** `{ op: "job_status", auth_token, job_id }`
**Response:** `{ status: "queued|running|ready|failed", result?: { ... }, error?: { code, message } }`

### Dashboard ops

#### `op: "acknowledge_alert"`
**Request:** `{ op: "acknowledge_alert", auth_token, alert_id }`
**Response:** `{ alert_id, acknowledged_at, already_acknowledged: boolean }`
**Behaviour:** Patches the Operational Alerts row with `acknowledged_at = nowIso_()` and `acknowledged_by = "admin"`. The row is kept for audit. Idempotent — second ack returns `already_acknowledged: true` and the existing timestamp without writing again. The dashboard reads alerts where `acknowledged_at` is empty, so dismissed alerts fall out of the panel naturally.
**Errors:** `NOT_FOUND` (no row with that alert_id), `VALIDATION_FAILED` (alert_id missing or > 64 chars), `UNAUTHORIZED` (no auth token).

#### `op: "health_check"`
**Request:** `{ op: "health_check" }` — no auth required, in `PUBLIC_OPS`.
**Response:**
```json
{
  "server_time": "2026-05-04T11:42:21.974Z",
  "script_properties": {
    "GITHUB_PAT":      { "required": true,  "set": false },
    "OPENAI_API_KEY":  { "required": true,  "set": true },
    "OPENAI_DAILY_CAP_GBP": { "required": false, "set": false }
  },
  "sheet_counts": { "Breeds": 1, "Groom Profiles": 1, "AI Call Log": 14, ... },
  "last_ai_call": {
    "created_at":  "2026-05-04T09:51:57.373Z",
    "model":       "gpt-5",
    "source":      "vision_page",
    "success":     true,
    "error_code":  ""
  },
  "openai_today_gbp": 0.0874
}
```
**Behaviour:** Returns booleans only for Properties (never the values themselves), row counts for the operationally interesting sheets, the most recent AI Call Log entry, and today's GBP spend. Surfaces in the dashboard's "Backend health" card. Read-only and cheap.

### Backlog (called by TV — separate concern, here for completeness)

#### `op: "log_backlog_hit"`
**Request:** `{ op: "log_backlog_hit", raw_breed, source: "manual_search" }` — no auth required, called by TV.
**Behaviour:** upserts `Backlog Signals` row with hit count.

---

## Image proxy (separate Web App, `doGet`)

**Reason for existing:** Drive's CDN doesn't reliably set `Access-Control-Allow-Origin`. The snipping tool's Cropper.js needs CORS-clean images. Apps Script can serve Drive blobs with explicit headers we control.

**URL pattern:** `https://script.google.com/macros/s/<deployment-id>/exec?id=<drive_file_id>&token=<auth_token>`

**Response:**
```
Content-Type: image/jpeg
Access-Control-Allow-Origin: https://fairytails123.github.io
Access-Control-Allow-Credentials: false
Cache-Control: private, max-age=3600
```

Body is the Drive blob. `token` query param replaces the body-field auth (necessary because `<img>` tags can't send POST bodies).

Apps Script Web App settings: `Execute as: Me, Who has access: Anyone with the link` — access is gated by the token, not by Google's auth.

---

## Quota guard rails

- 6-min Apps Script execution per request: each Phase 2 op is well under this (extract_sections ≤30s, single vision page ≤30s).
- ~20K UrlFetch/day budget: GitHub Contents API (~10/day), OpenAI calls (~10-20 per breed × ~10 breeds/day = ~200/day).
- **OpenAI daily cap:** `OPENAI_DAILY_CAP_GBP` Script Property (default `5.0`). Sum of today's `cost_usd` from `AI Call Log` × `OPENAI_USD_TO_GBP` (default `0.85`) is checked before every AI op. Cap exceeded → `QUOTA_EXCEEDED`. One-per-day Operational Alerts row logged.
- `LockService.getScriptLock()` on every mutation, 30s timeout (60s for AI ops via `withProfileLock_`).
- Login rate limit: 50 fails/day in Script Properties, reset by midnight cron.

## Required Script Properties

| Key | Required? | Default | Notes |
|---|---|---|---|
| `OPENAI_API_KEY` | yes (Phase 2) | — | sk-proj-… |
| `OPENAI_DAILY_CAP_GBP` | optional | `5.0` | soft cap; `0` disables |
| `OPENAI_USD_TO_GBP` | optional | `0.85` | conservative; reality ~0.79 |
