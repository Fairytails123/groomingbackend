# HANDOVER — Fairy Tails Grooming Knowledge Software

> **If you are a fresh Claude session, read this file in full first**, then the spec at `.md/grooming-knowledge-software-architecture.md`. Memory at `<.claude>/projects/.../memory/` has user/project/feedback/reference notes you should also load. The system is **live and working** end-to-end through Stage 5; only Stage 3 Phase 2 (AI extraction) is pending.

**Last updated:** 2026-05-03 — end-of-session snapshot. Repo at commit `bff73b3`. Apps Script Web App at deployment `@4`. All 13 sheets populated. Snipping tool fixed and verified working.

---

## TL;DR for next session

1. Most things just work — log in, add breeds, edit profiles, snip diagrams from page renders, publish (once GitHub PAT is added).
2. **Two Kamal-side actions still gate full operation**: (a) set `GITHUB_PAT` Script Property so publish writes to GitHub Pages succeed, and (b) wire credentials in n8n so cron handlers can fire.
3. **Build work remaining**: Stage 3 Phase 2 — Telegram PDF intake → AI text/vision extraction → heading approval. Telegram bot token + chat ID provided (saved in `.secrets/`).
4. The `.md/grooming-knowledge-software-architecture.md` spec is at v3.7 — the canonical reference for any "how should this work" question.

---

## What this project is

Two connected pieces of software that support a permanent **daily knowledge-building loop** for a UK dog grooming salon (Fairy Tails K9 Centre, Kamal). The morning's JotForm bookings drive what gets digitised; Kamal uploads breed-specific Adobe Scan PDFs via Telegram during the day; AI extracts text + Kamal snips diagrams from page renders in a backend website; the breeds go live on the salon TV before opening.

This repo (`Fairytails123/groomingbackend`) is the **back-end + admin website**. The TV display is a separate future build.

---

## Live deployment state

Everything below is live and verified working unless flagged ⏳ pending.

### Hosting & code

| What | Where |
|---|---|
| GitHub repo | https://github.com/Fairytails123/groomingbackend |
| GitHub Pages site | https://fairytails123.github.io/groomingbackend/ |
| Admin website (login) | https://fairytails123.github.io/groomingbackend/admin/login.html |
| Apps Script project | https://script.google.com/home/projects/1sxgzOrmd2OEmuJmMeoW15Vbb1GkbO1GIhs3h0afmOafcgOb1tDErvIA1/edit (project ID `1sxgzOrmd2OEmuJmMeoW15Vbb1GkbO1GIhs3h0afmOafcgOb1tDErvIA1`) |
| Apps Script Web App URL | `https://script.google.com/macros/s/AKfycby5CU8J-xyCn38ruoe_HdDswRBCNcxXLO9O2AyiiHDt781mwsJzWeyyahySfwjpq4ZL/exec` (deployment `@4`, persistent) |
| n8n workflow | https://ftmanager.app.n8n.cloud/workflow/6xHWEX3f9zrWtDDa ("Dog Grooming Back End") |

### Data + storage

| What | Where |
|---|---|
| Sheets workbook ("Grooming Backend") | https://docs.google.com/spreadsheets/d/1SZtkWUjXXgRIO5CzB_8NBeJ0_SEEq5k3IMAEPBZN01s/edit (ID `1SZtkWUjXXgRIO5CzB_8NBeJ0_SEEq5k3IMAEPBZN01s`) — 13 sheets populated |
| Drive root folder ("Dog Grooming Back end") | https://drive.google.com/drive/folders/1Ry1YbBVhPwlvb6WFnsxiEBPvBzDDlNUk (ID `1Ry1YbBVhPwlvb6WFnsxiEBPvBzDDlNUk`) |
| Per-breed folders | Auto-created under root by `op_save_page_render` / `op_save_crop` / publish flow |

### Apps Script Properties (already set)

```
ADMIN_PASSWORD_HASH      sha256(salt + plaintext)
ADMIN_PASSWORD_SALT      32-byte random
SESSION_SECRET           32-byte random (for HMAC tokens)
SPREADSHEET_ID           1SZtkWUjXXgRIO5CzB_8NBeJ0_SEEq5k3IMAEPBZN01s
DRIVE_ROOT_ID            1Ry1YbBVhPwlvb6WFnsxiEBPvBzDDlNUk
GITHUB_OWNER             Fairytails123
GITHUB_REPO              groomingbackend
JOTFORM_API_KEY          ********** (in .secrets/jotform-api-key.md)
JOTFORM_FIELD_BREED      26
JOTFORM_FIELD_DOG_NAME   9
JOTFORM_FIELD_APPT_TYPE  8
JOTFORM_FIELD_DATE_FG_BUS 3
JOTFORM_FIELD_DATE_FG_PRT 20
```

⏳ **Pending Apps Script Property**: `GITHUB_PAT` (fine-grained PAT for Contents read+write on `Fairytails123/groomingbackend`). Without it, `op_publish_profile` will fail with `GITHUB_FAILED`. Everything else works.

### Secrets (gitignored — `.secrets/`)

| File | Contents | Used in |
|---|---|---|
| `.secrets/telegram-token.md` | Bot token `8684875673:AAES...yWA` + chat ID `-5072836532` | n8n Telegram credential (when Stage 3 Phase 2 ships); future direct Apps Script Telegram sends |
| `.secrets/jotform-api-key.md` | API key `9679f54068483fef3d3f72e589a2865e` | Already set in Apps Script Properties as `JOTFORM_API_KEY` |

These files are git-ignored. Memory holds pointers to them, never the values.

### Login

- URL: https://fairytails123.github.io/groomingbackend/admin/login.html
- Password: `fairytails22` (chosen by Kamal; hashed in Apps Script Properties; plaintext was staged via the one-time `DEFAULT_PASSWORD` Property mechanism that auto-deletes after `setupAll` runs)

---

## Authoritative docs

| Doc | What's in it |
|---|---|
| `.md/grooming-knowledge-software-architecture.md` | **Canonical spec, v3.7.** Sheets schema, Drive layout, API contract, atomic publish, all the design decisions |
| `.md/*.v3.4.backup.md` / `*.v3.5.backup.md` / `*.v3.6.backup.md` | Earlier spec versions kept for diff context |
| `docs/HANDOVER.md` | This file — operational truth |
| `docs/api.md` | Apps Script op catalogue (request/response shapes) |
| `docs/workflows.md` | n8n workflow catalogue (12 workflows + AI prompts + Telegram stubbing) |
| `<.claude>/plans/read-the-md-files-glimmering-glacier.md` | Original approved plan from session start (mostly historical now) |
| `<.claude>/projects/.../memory/` | Cross-session memory — user, project, feedback, reference notes |

---

## What's done — feature checklist

Each row links the relevant commit so a `git show` brings up the diff.

### Stage 2 — admin editor + JotForm session pack

- ✅ Repo scaffolded, brand CSS, login flow (`bbad832`)
- ✅ Profile editor with TEXT/IMAGES/DISPLAY/HISTORY tabs, debounced autosave, blade-pill UI; groom-types CRUD; setup.gs bootstrapper (`a722812`)
- ✅ GitHub Contents API publish; image upload + publish admin pages (`b1db963`)
- ✅ Quick-add-or-update breed card on dashboard with autocomplete (`dbc1352`)

### Stage 3 — snipping tool

- ✅ **Phase 1**: Cropper.js v1.6.2 vendored; `snip.html` with filmstrip + canvas + role buttons (M/F/B/H/S keyboard shortcuts); `crops.gs` with `op_list_page_renders`, `op_save_page_render`, `op_save_crop`, `op_list_crops_for_render` (`9626999`)
- ✅ Drive serving fixed: switched to `lh3.googleusercontent.com/d/<id>=s0` URLs + auto-public sharing on upload + `makeAllImagesPublic()` retro-fix helper (`bff73b3`)
- ✅ IMAGES tab on profile editor lists real page-render + image counts with thumbnails (`5e0427e`)
- ⏳ **Phase 2**: Telegram PDF intake, AI text extraction (GPT-4o-mini), AI vision pass (GPT-4o), heading approval — NOT YET BUILT. n8n workflow has webhook-stub placeholders.

### Stage 4 — cron handlers + fuzzy matcher

- ✅ Token-based fuzzy matcher with confidence scoring + Breed Match Cache writeback + Backlog Signals upsert (`1ef851d`)
- ✅ `op_rebuild_today_json`, `op_rebuild_tomorrow_json`, `op_send_tomorrow_prep_alert` — fetch JotForm submissions, filter to Full Groom, run through fuzzy matcher, build today.json / tomorrow.json, push to GitHub Pages, write Telegram-Outbox row (`1ef851d`)
- ✅ JotForm EU endpoint patch — `eu-api.jotform.com` (account is in EU Safe mode) (`2080665`)
- ✅ Lenient appt-type matching (substring instead of exact set) (`b039958`)

### Stage 5 — dashboard reads + history + ops alerts

- ✅ `dashboard_status_counts`, `dashboard_recent_uploads`, `dashboard_backlog`, `dashboard_alerts`, `dashboard_tomorrow_prep` (reads from public GitHub-Pages tomorrow.json) (`080b22f`)
- ✅ HISTORY tab on profile editor reads Version History sheet (lazy-loaded on tab switch) (`080b22f`)
- ✅ Operational Alerts panel on dashboard (`080b22f`)

### n8n workflow Phase 1

- ✅ "Dog Grooming Back End" workflow `6xHWEX3f9zrWtDDa` populated with sticky-noted architecture + 4 entry points (cron 06:00+11:30, cron 07:00, cron 19:00, Telegram intake webhook stub, crop generation webhook stub)
- ⏳ Cron HTTP Request nodes have placeholder for Apps Script URL (need Kamal to paste actual URL into n8n editor)
- ⏳ No credentials wired yet (Kamal does this once Sheets is ready — Sheets IS ready now)

---

## Bugs fixed during this session (so we don't reintroduce them)

In chronological order:

1. **clasp create overwrote `appsscript.json` with a default manifest** — clasp's "Cloned one file" step pulled the project's default manifest down. Fix: `git checkout HEAD -- appsscript.json` then re-pushed. Lesson: after `clasp create`, always re-checkout local appsscript.json before `clasp push`.

2. **JotForm `discoverJotFormFields` returned empty `data.content`** — root cause: account is in EU Safe mode; `api.jotform.com` returned a 301 redirect to `eu-api.jotform.com` that UrlFetchApp didn't follow cleanly for JSON. Fix: hardcode `eu-api.jotform.com` as the new default in `session_pack.gs`, with optional `JOTFORM_API_BASE` Script Property override for non-EU accounts (`2080665`).

3. **JotForm appt-type filter matched zero submissions** — `APPT_TYPES_FULL_GROOM` was an exact-string `Set` against the spec's idealised labels (`"Full Groom or Hand Strip — with bus pick-up/drop-off"`); real JotForm option text uses different em-dashes / capitalisation. Fix: switched to substring match — true if value contains "full groom" or "hand strip" AND doesn't contain "bath" or "teeth" (`b039958`).

4. **Snipping tool images not loading (CRITICAL)** — `<img crossorigin="anonymous">` strips auth cookies → Drive returns 403 for private files → `naturalWidth: 0`. Even when the file owner is signed in. Affected the page-render thumbnail, the Cropper canvas image, and the All-crops sidebar tiles. Fix:
   - `imageProxyUrl_` now serves via `lh3.googleusercontent.com/d/<id>=s0` (Google Photos's CDN — returns CORS-permissive headers AND works with `crossorigin="anonymous"`)
   - `op_save_page_render` and `op_save_crop` set Drive sharing to `ANYONE_WITH_LINK / VIEW` immediately on file create
   - One-shot `makeAllImagesPublic()` helper retro-fits sharing for any pre-existing files (already run on the live data — `fixed=2`)
   - `snip.js` crop-tile thumbs also switched to lh3 format
   - Verified: page render image loads at 1200px wide; `canvas.toDataURL()` returns base64 JPEG without `SecurityError` (canvas not tainted)
   - Trade-off: Drive page-render and crop files are now publicly viewable to anyone with the URL. Image-id-based filenames are unguessable as a soft barrier. Fine for personal-scale; if stricter isolation needed later, swap in an Apps Script doGet image proxy. (`bff73b3`)

5. **Profile editor IMAGES tab showed stale "ships in Stage 3" placeholder** — text was written before the snipping tool shipped; user couldn't find the working "Open snipping tool" button next to the heading. Fix: replaced placeholder with a real listing of page renders + cropped images (lazily loaded via `list_page_renders` + `list_images`) plus a more prominent CTA button (`5e0427e`).

6. **Apps Script "Authorization required" popup blocked** — the OAuth consent dialog from `setupAll`'s first run opened in a separate Chrome window outside the MCP tab group, so I couldn't drive it. Resolution: asked Kamal to click through it once. Lesson: any first-run Apps Script function that touches Drive/Sheets needs human OAuth consent that can't be auto-clicked from a different MCP tab.

---

## Pending work for next session

### Build work — Stage 3 Phase 2 (the big remaining piece)

The AI extraction chain that turns an uploaded Adobe Scan PDF into a `Needs Review` profile. Spec §4.2 / §5.3 / §6 cover the design; `docs/workflows.md` has the exact prompts. Five n8n workflows + supporting Apps Script:

1. **WF-04 Telegram intake** — bot receives PDF document → save to Drive (under the right breed/profile folder) → create profile row with status `Processing` → confirm to Kamal in Telegram
2. **WF-05 Backend intake** — `op_upload_pdf` from `/admin/upload.html` triggers same downstream as WF-04
3. **WF-06 Text extraction** — `pdftotext` → GPT-4o-mini structures into 5 core sections + extra headings + blade numbers + per-section confidence
4. **WF-07 Page rendering** — `pdftoppm` per-page JPEGs → Drive `02-page-renders/` → Page Renders sheet rows. Replaces the manual "+ Add page render" upload in snip.html (which can stay as a fallback)
5. **WF-08 AI vision pass** — GPT-4o per page render for handwritten annotations + missed blade numbers
6. **WF-09 Heading approval** — Telegram message with inline approve/ignore/edit buttons → Sheet 6 → flip status to `Needs Review`

Constraints / rules from the spec:
- Three workflows for AI extraction (not one) — different failure profiles, different retry semantics, parallel WF-06/WF-07
- `pdftoppm` requires a Linux execution environment — n8n's Code node runs JS only, so we'd need a Cloud Function / VM, OR use a browser-side JS PDF-to-image library invoked from `/admin/upload.html` (sends ready-made page renders to the existing `op_save_page_render`)
- Telegram is stubbed via the `Telegram Outbox` sheet for development; flip to live by setting n8n's Telegram credential and toggling a `TELEGRAM_LIVE` env var in the workflow

**Recommended order:**
1. Easiest first win: build the **manual upload-PDF** flow (Apps Script `op_upload_pdf` + `/admin/upload.html` enhancement). Use `pdf.js` in the browser to render each page as a JPEG and POST to `op_save_page_render`. No n8n needed; no Linux dependency.
2. Wire WF-06 (text extraction): `pdftotext` runs in n8n's Execute Command node OR use `pdfjs-dist` in the browser to extract text. POST to a new `op_save_extracted_sections` op.
3. Wire WF-08 (AI vision): for each Page Renders row, send the JPEG to GPT-4o vision via n8n. Use prompts in `docs/workflows.md`. Write findings into Groom Knowledge sheet.
4. Wire WF-04 + WF-09 once WF-06/07/08 chain is solid (Telegram bot needs token from `.secrets/`).

### Smaller follow-ups

- ⏳ `GITHUB_PAT` Script Property — Kamal needs to generate a fine-grained PAT for `Fairytails123/groomingbackend` with Contents read+write, paste it into Apps Script Properties. Until then, `op_publish_profile` fails with `GITHUB_FAILED`. Test plan: add a breed, edit it, click Publish — should land at https://fairytails123.github.io/groomingbackend/public/breeds/<slug>.json
- ⏳ n8n credentials — Google Sheets/Drive (OAuth), GitHub (HTTP Header Auth with PAT), OpenAI (key — Stage 3 Phase 2 only), Telegram (paste token from `.secrets/telegram-token.md`). Kamal does this in n8n's Credentials UI.
- ⏳ n8n HTTP Request nodes in `Dog Grooming Back End` workflow have a `placeholder('Apps Script Web App URL')` — paste the real URL `https://script.google.com/macros/s/AKfycby5CU8J-xyCn38ruoe_HdDswRBCNcxXLO9O2AyiiHDt781mwsJzWeyyahySfwjpq4ZL/exec` into all three.
- ⏳ Add midnight time trigger for `resetLoginFailCounter` (Apps Script editor → Triggers → Add Trigger → daily 00:00 UTC). Stops the brute-force counter from accumulating forever.
- ⏳ JotForm webhook → n8n WF-01 trigger (so `today.json` rebuilds within seconds of a new booking, not just on the 06:00 / 11:30 cron).

---

## Plan from here on (sequenced)

### Phase A — finish the Kamal-side wiring (1 sitting, ~30 min)

1. Generate GitHub PAT (Settings → Developer → Fine-grained tokens, scoped to `Fairytails123/groomingbackend`, Contents r/w + Metadata r). Paste into Apps Script `GITHUB_PAT` Property.
2. Smoke-test publish: log in, find Miniature Schnauzer, edit the Body section, click Publish on `/admin/publish.html`. Verify `public/breeds/miniature-schnauzer.json` lands on GitHub Pages with the correct shape.
3. In n8n, paste Apps Script URL into the three HTTP Request nodes' URL placeholder, save the workflow, activate it.
4. In n8n Credentials, create: Google Sheets OAuth, Google Drive OAuth, HTTP Header Auth for GitHub (header name `Authorization`, value `Bearer <PAT>`), OpenAI API (key — only needed for Stage 3 Phase 2).
5. Add the resetLoginFailCounter trigger.

### Phase B — Stage 3 Phase 2 (the big build, ~1-2 sessions)

1. **PDF page rendering in browser** — vendor `pdf.js`, add a "Upload PDF" mode to `/admin/upload.html` that converts each page to a JPEG via `pdf.js` + `<canvas>` and POSTs to `op_save_page_render`. This unblocks the snipping flow without any n8n / Linux dependency.
2. **AI text extraction** — also browser-side: `pdf.js`'s `getTextContent()` extracts the printed text. POST to a new Apps Script op `op_save_extracted_sections({profile_id, raw_text})` which calls the OpenAI Chat Completions API directly (UrlFetchApp) using the prompt in `docs/workflows.md` §6.1, parses the JSON response, populates Groom Knowledge sheet.
3. **AI vision pass** — for each Page Renders row, optional "Run vision pass" button on the IMAGES tab. POSTs page render to a new op `op_run_vision_pass` which calls GPT-4o vision with the prompt in §6.2, merges findings into Groom Knowledge.
4. **Telegram bot intake** — n8n WF-04 + WF-09. Use the bot token from `.secrets/`. Bot receives PDF, downloads via `getFile`, uploads to Drive, fires the op chain above. Heading approval message uses inline buttons.
5. **Cost guard rails** — log every OpenAI call to Operational Alerts sheet with token count + cost estimate. Alert if daily spend >£5.

### Phase C — TV display (separate, future build)

Not in this repo's scope. The published JSON shapes are designed and documented (spec §5.2). When ready: new repo `grooming-display`, vanilla HTML/JS PWA, reads `public/today.json` + `public/breeds/*.json` from this repo's GitHub Pages.

### Phase D — polish + ops

- Better error surfacing on the dashboard (the Operational Alerts panel exists but no `op_acknowledge_alert` to clear them)
- Server-side cropping (n8n + Pillow) to replace client-side `canvas.toDataURL()` for byte-perfect crops — only matters if we ever see image-quality issues
- Apps Script doGet image proxy with token gating — only matters if we want to lock down Drive image URLs (currently public by URL)
- Backend repo for the TV (Phase C)

---

## How to pick up cold (next-session Claude, step by step)

1. **Read this file in full** (you just did).
2. **Read the spec**: `.md/grooming-knowledge-software-architecture.md` (v3.7). The §0 amendments section at the top is the diff-from-original.
3. **Skim memory**: `<.claude>/projects/.../memory/MEMORY.md` is the index. Notable: `feedback_telegram_token_at_end.md` — token is now provided; `feedback_design_first.md` — user wants planning before code; `feedback_living_spec.md` — fold decisions back into spec; `reference_external_services.md` — external IDs and where secrets are saved.
4. **Verify the system is still alive**: `curl -s https://fairytails123.github.io/groomingbackend/admin/login.html | head -5` should return HTML. Then visit https://fairytails123.github.io/groomingbackend/admin/login.html in browser, log in with `fairytails22`.
5. **Check git state**: `git log --oneline -20` should match the commits referenced in this file. Last commit `bff73b3`.
6. **If user asks about a feature that "should already work"**: check the "What's done" section above. If the file mentioned exists locally and is committed, the feature is live (modulo GitHub Pages cache; hard-refresh).
7. **If user reports a bug**: check the "Bugs fixed" section first — don't reintroduce a fixed bug. If novel: drive Chrome MCP to reproduce, use `mcp__Claude_in_Chrome__javascript_tool` to inspect state, fix, push.
8. **For new work**: respect "design first" feedback — for non-trivial changes, sketch a plan before writing code, fold the design decisions back into the spec.

---

## Update protocol for this file

Keep this file updated as the source of truth:

- After every meaningful chunk of work
- When a bug is fixed (add to chronological list)
- When a Property / credential / external state changes
- When a stage milestone completes
- Before context approaches limit (so a fresh session can resume)

Aim for ≤700 lines. Push deeper detail to `docs/api.md`, `docs/workflows.md`, the spec, or a stage-specific doc.
