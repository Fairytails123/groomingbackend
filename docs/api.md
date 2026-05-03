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

**Error codes:** `UNAUTHORIZED`, `NOT_FOUND`, `VALIDATION_FAILED`, `CONFLICT`, `QUOTA_EXCEEDED`, `GITHUB_FAILED`, `TIMEOUT`, `INTERNAL`.

**Concurrency:** Mutating ops accept `expected_version` (int). Server compares against `Groom Profiles.current_version`; mismatch returns `CONFLICT`. This guards two-tabs-same-user accidents.

**Async work:** Long ops return `{ ok: true, data: { job_id, status: "queued" } }`. Client polls `op: "job_status"` with `{ job_id }` until `status: "ready"` or `"failed"`. Backed by a `Jobs` sheet + a 1-minute time trigger that picks up `queued` rows. This sidesteps the 6-min Apps Script execution limit.

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
**Behaviour:** soft-delete. Removes from `display_settings.supplementary_order`. JPEG remains in Drive (referenced by version history).

#### `op: "list_page_renders"`
**Request:** `{ op: "list_page_renders", auth_token, profile_id }`
**Response:** `{ page_renders: [ { page_render_id, page_index, url, width_px, height_px } ] }`. `url` is the Apps Script image-proxy URL.

### Uploads

#### `op: "upload_pdf"` (async)
**Recommended flow:** browser uploads PDF directly to Drive via resumable upload using a short-lived OAuth token returned by Apps Script — Apps Script's POST body cap is too small for some Adobe Scans. Then call this op to trigger processing.

**Request:** `{ op: "upload_pdf", auth_token, breed_id?, breed_name?, groom_type, source_type, drive_file_id }`
**Behaviour:** creates breed if `breed_name` is novel, creates a profile in `Processing`, enqueues n8n WF-04/05 intake. Returns `{ profile_id, job_id }`. Client polls until `Needs Review`.

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

- 6-min Apps Script execution per request: enforce by routing any op that touches more than ~50 rows or makes more than 5 UrlFetch calls through the Jobs queue.
- ~20K UrlFetch/day budget: reserved for GitHub Contents API calls (~10/day) and n8n webhook fires (~20/day). Apps Script does NOT call ChatGPT — that's n8n's job.
- `LockService.getScriptLock()` on every mutation, 30s timeout.
- Login rate limit: 50 fails/day in Script Properties, reset by midnight cron.
