# HANDOVER — Fairy Tails Grooming Knowledge Software

> Continuously updated. If you're a fresh Claude context picking this up, **read this file first**, then `.md/grooming-knowledge-software-architecture.md` (the canonical spec), then the approved plan at `C:\Users\FT Manager\.claude\plans\read-the-md-files-glimmering-glacier.md`.

**Last updated:** 2026-05-03 — Stages 2 Weeks 1-2 pushed; Week 3 partially pushed (publish.gs + github.gs + setupAll DEFAULT_PASSWORD hook). Repo is at `Fairytails123/groomingbackend@main`, GitHub Pages live at https://fairytails123.github.io/groomingbackend/ . Drive folder ID `1Ry1YbBVhPwlvb6WFnsxiEBPvBzDDlNUk` recorded. Password gate is in place — user-chosen plaintext is staged via `DEFAULT_PASSWORD` Script Property and never committed. Building upload + publish admin pages next, then populating n8n workflow `6xHWEX3f9zrWtDDa` (Dog Grooming Back End).

---

## What this project is

Two connected web apps that support a permanent **daily knowledge-building loop** for a UK dog grooming salon (Fairy Tails K9 Centre). Every morning, n8n looks at tomorrow's JotForm bookings and Telegrams Kamal a list of breeds not yet in the knowledge base. Kamal uploads breed-specific Adobe Scan PDFs via Telegram, AI extracts text, Kamal snips diagrams in the admin website, and the breeds go live on the salon TV before opening. Loop runs forever.

This build covers the **admin/back-end layer only**:
- Admin website (vanilla JS, multi-page, GitHub Pages)
- Apps Script API (single Web App URL, op-dispatch on POST)
- Google Sheets database (10 sheets)
- Google Drive file store
- n8n orchestration (12 workflows)
- Telegram bot (stubbed until Kamal provides the token at end of build)
- AI extraction (GPT-4o-mini text + GPT-4o vision)
- Snipping tool (Cropper.js + server-side Pillow crop)

The **TV display is deferred** to a separate phase. Published JSON shapes the TV will consume are designed and produced here, but no TV-specific code is being written.

---

## Where everything authoritative lives

| Authority | Path |
|---|---|
| Canonical architecture spec (v3.6) | `.md/grooming-knowledge-software-architecture.md` |
| v3.5 spec backup (pre design pass) | `.md/grooming-knowledge-software-architecture.v3.5.backup.md` |
| v3.4 spec backup (pre snipping-tool change) | `.md/grooming-knowledge-software-architecture.v3.4.backup.md` |
| Approved plan file | `C:\Users\FT Manager\.claude\plans\read-the-md-files-glimmering-glacier.md` |
| Data + API design (agent output) | `docs/data-api-design.md` (saved post-plan-approval) |
| Admin + workflows design (agent output) | `docs/admin-workflows-design.md` (saved post-plan-approval) |
| Memory (Claude side) | `C:\Users\FT Manager\.claude\projects\C--Users-FT-Manager-Desktop-Co-Work-Grooming-Software\memory\` |

---

## Locked decisions (do NOT relitigate)

1. Multi-page vanilla JS admin website. No framework, no build step. Cropper.js + Fuse.js vendored under `/vendor/`.
2. Apps Script API: single Web App URL, single POST endpoint, dispatches on `op` field of JSON body. Long ops queue via a `Jobs` sheet + 1-min time trigger.
3. Auth: shared password gate. Hash in Apps Script `PropertiesService`. Login mints 12-h HMAC token; sent in body (Apps Script strips non-standard headers); stored in `localStorage`; rotated each call.
4. Crop generation is server-side via n8n + Pillow. Browser sends `(x, y, w, h)` only. Source page-render JPEG is canonical; crops regenerable from coordinates. Solves CORS-on-canvas + preserves "images preserved exactly" rule.
5. Drive serving for the snipping tool goes via Apps Script proxy with explicit `Access-Control-Allow-Origin` headers. Token-protected.
6. Three-step extraction chain: WF-06 (pdftotext + GPT-4o-mini structuring) ∥ WF-07 (pdftoppm renders) → WF-08 (GPT-4o vision) → WF-09 (heading approval). Different failure profiles, different retry semantics. WF-06 and WF-07 run in parallel.
7. Cropper.js v1.6.x vendored, NOT CDN. Touch enabled (mobile snipping in scope).
8. Published JSON commits to the same `groomingbackend` repo, under `/public/`. GitHub Pages serves from there.
9. Mobile snipping IS supported. Filmstrip becomes horizontal scroller at <768px.
10. Single editor (Kamal). Concurrency: `expected_version` ETag on every mutating op (covers the two-tabs-same-user case).
11. **Telegram bot setup happens at the END of the build.** Kamal provides token then. n8n Telegram nodes use a credential left empty during build; messages can be stubbed to a `Telegram Outbox` sheet for verification.

---

## Spec amendments folded into v3.6 (2026-05-03 design pass)

See §0 of the spec for the full list. Highlights:
- Sheet 4b (Page Renders) added — was implicitly required by `source_page_render_id` references but had no schema.
- Sheet 10 (Operational Alerts) added.
- Sheet 2 status enum extended with `Processing` and `Failed` plus error/publish-state fields.
- Sheet 1 gains `slug`; Sheet 3 gains `section_id`; Sheet 4 drops `is_main`; Sheet 8 source enum gains `unmatched`.
- Workflow #10 (Crop generation) added; Workflow #1 also fires on JotForm webhook.
- New §6.10 (Atomic publish) and §6.11 (API contract) sections with the full transaction ordering and op catalogue.
- Decisions #21 (mobile snipping) and #22 (single repo for admin + published JSON) added.
- §9 questions #5 and #6 resolved; new question #9 (Telegram token at end of build) added.

---

## Current build state

### Scaffolded ✅ (Stage 2 Week 1 complete on Claude side)

**Repo + docs:**
- Folder structure: `apps-script/lib/`, `admin/css/pages/`, `admin/js/pages/`, `vendor/cropperjs/` (empty — Cropper.js to be vendored Stage 3), `vendor/fuse/` (empty — Fuse.js to be vendored when search needs it), `public/breeds/`, `public/images/`, `n8n/`, `docs/`.
- `README.md` — setup + deploy instructions (8-step Kamal runbook).
- `.gitignore` — clasp metadata, node, OS, env.
- `index.html` (repo root) — meta-refresh redirect into `/admin/`.
- `docs/HANDOVER.md` — this file.
- `docs/api.md` — Apps Script op catalogue (full request/response shapes).
- `docs/workflows.md` — n8n workflow specs incl. AI prompts, Telegram stubbing approach.
- `.md/grooming-knowledge-software-architecture.md` — v3.6 spec (current).
- `.md/grooming-knowledge-software-architecture.v3.5.backup.md`, `*.v3.4.backup.md` — version history.

**Memory (Claude side):** 9 entries + index in `<.claude>/projects/.../memory/`:
- `MEMORY.md`, `user_kamal.md`, `project_grooming_software.md`
- `feedback_design_first.md`, `feedback_living_spec.md`, `feedback_handover_continuity.md`, `feedback_telegram_token_at_end.md`
- `reference_repo.md`, `reference_arch_doc.md`, `reference_external_services.md`

**Admin website (vanilla JS, multi-page):**
- HTML: `admin/index.html` (redirect router), `admin/404.html`, `admin/login.html`, `admin/dashboard.html`, `admin/library.html`.
- CSS: `admin/css/tokens.css` (brand palette `#00B4D8 / #0077B6 / #023E8A` + type scale + spacing + status pill tokens), `base.css` (resets + global type), `components.css` (top bar, buttons, cards, tables, status pills, toasts, modal).
- Shared JS: `admin/js/config.js` (URL config — `APPS_SCRIPT_URL` placeholder to fill post-deploy), `auth.js` (token storage + `requireSession` + `wireLogoutLink`), `api.js` (fetch wrapper, op-dispatch payload, 401-redirect, network/timeout handling), `store.js` (event-emitter), `ui.js` (toast + status pill + confirm/form modal), `format.js` (date/time/breed-type/pluralise).
- Page JS: `admin/js/pages/login.js` (full login flow), `dashboard.js` (4 panels with graceful fallback when API ops aren't deployed), `library.js` (list + filter + new-breed modal).

**Apps Script backend (deploys via clasp):**
- `apps-script/appsscript.json` — manifest with required oauthScopes (Sheets, Drive, UrlFetch, ScriptApp).
- `apps-script/.clasp.json.example` — template for the user to copy after `clasp create`.
- `apps-script/Code.gs` — `doPost` op-dispatcher with `OP_REGISTRY`, `doGet` stub for image proxy (Stage 3).
- `apps-script/auth.gs` — `login`/`logout`/`ping`, HMAC-SHA256 token mint/verify, password hashing, brute-force counter, `setupSessionSecret()` + `setupSalt()` + `setAdminPassword()` setup helpers, `resetLoginFailCounter()` for the midnight cron.
- `apps-script/ids.gs` — `nextId_("breed")` etc., `slugify_`, `uniqueBreedSlug_`.
- `apps-script/breeds.gs` — `op_list_breeds`, `op_save_breed` (create + update), `op_search_breeds`, `op_override_breed_match`, sheet read/write helpers.
- `apps-script/lib/lock.gs` — `withScriptLock_`, `withProfileLock_`.
- `apps-script/lib/validate.gs` — `requireString_`, `requireEnum_`, `requireInt_`, `optional_`.

**Working ops at the API surface:**
- ✅ `login`, `logout`, `ping`
- ✅ `list_breeds`, `save_breed`, `search_breeds`, `override_breed_match`
- ✅ Dashboard placeholder ops (`dashboard_tomorrow_prep`, etc.) returning empty so the dashboard renders cleanly
- 🟡 All other ops registered but throw `NOT_FOUND` with "coming in a later stage" — implementation lands in Week 2/3.

### Pending (Kamal's external setup — minimised by automation)

These genuinely need Kamal's hands (Google OAuth, password choice, BotFather security):

1. **Drive folder** — done ✅ (`1Ry1YbBVhPwlvb6WFnsxiEBPvBzDDlNUk`).
2. **GitHub repo + Pages** — done ✅ (pushed; Pages enabled programmatically via gh API).
3. **`clasp login`** (one-time OAuth in his shell): `cd apps-script && clasp login && clasp create --type webapp --rootDir . --title "Grooming Backend API" && clasp push`. Then deploy: in the Apps Script editor (`clasp open`), Deploy → New Deployment → Web App, "Execute as: Me", "Who has access: Anyone". Copy the Web App URL.
4. **Generate fine-grained PAT** for `Fairytails123/groomingbackend` (Contents read+write).
5. **In Apps Script editor → Project Settings → Script Properties**, add:
   - `DRIVE_ROOT_ID` = `1Ry1YbBVhPwlvb6WFnsxiEBPvBzDDlNUk`
   - `DEFAULT_PASSWORD` = (the agreed-upon password — see chat)
   - `GITHUB_PAT` = (the PAT from step 4)
   Then run function `setupAll`. It creates the workbook, populates 13 sheets, hashes the password, deletes `DEFAULT_PASSWORD` so plaintext is gone.
6. **Edit `admin/js/config.js`** — paste `APPS_SCRIPT_URL` and `APPS_SCRIPT_IMAGE_PROXY_URL` (same URL works for both during Stage 2/3). Commit + push.
7. **Smoke test** from phone: open `https://fairytails123.github.io/groomingbackend/admin/login.html`, log in, add a breed, see it in the library and in Sheet 1.
8. **Telegram bot token** — provided at end of build. Plug into n8n's Telegram credential.

Everything else (Sheets schema setup, Drive sub-folder layout per breed, GitHub Pages enable, ID counters, etc.) is automated via Apps Script setup functions.

### Stage 2 Week 2 (next coding chunk)

Once Kamal validates Week 1 end-to-end:
- `apps-script/profiles.gs` — `op_get_breed_profile`, `op_save_profile` (atomic with `LockService` + `expected_version`), `op_list_groom_types`, `op_create_profile`, `op_archive_profile`, `op_duplicate_profile`.
- `admin/profile.html` + `admin/js/pages/profile.js` — TEXT / IMAGES / DISPLAY / HISTORY tabs. Sectioned text editor with debounced autosave.
- `admin/groom-types.html` + `admin/js/pages/groom-types.js` — full CRUD.
- 5 real breeds entered as smoke test (Cavapoo, Cockapoo, Cocker Spaniel, Mini Schnauzer, Bichon Frise).

### Stage 2 Week 3 (then)
- `admin/upload.html` + image upload (pre-Cropper, role dropdown).
- `admin/publish.html` + `apps-script/publish.gs` — atomic publish per spec §6.10.
- `apps-script/github.gs` — Contents API client.
- `n8n/WF-11-publish.json`, `WF-01-daily-session-sync.json` exports.
- `today.json` written by WF-01.

### Stage 3 (later)
Telegram bot (token from Kamal at end), AI extraction (WF-04..WF-09), snipping tool (WF-10 + Cropper.js + image proxy on Apps Script).

### Stage 4 (later)
Morning prep loop (WF-02 + WF-03).

### Stage 5 (later)
Fuzzy matcher with confidence scoring; version history UI; ops dashboard reading Sheet 10 (Operational Alerts).

---

## What does the user need to do externally?

These cannot be done by Claude — they need Kamal's hands or accounts:

1. **Create the Google Sheets workbook** with all 10 sheets (the schema is in spec §7). Add the `SPREADSHEET_ID` to Apps Script Properties.
2. **Create the `Grooming Knowledge Base/` Drive root folder.** Add the `DRIVE_ROOT_ID` to Apps Script Properties.
3. **Create the GitHub repo** (`Fairytails123/groomingbackend`) — currently empty on GitHub. Local files will need pushing once initial scaffolding is committable.
4. **Generate a fine-grained PAT** scoped to the `groomingbackend` repo with Contents read+write. Add `GITHUB_PAT` to Apps Script Properties.
5. **Deploy Apps Script** via clasp (`clasp create`, `clasp push`, `clasp deploy`). This produces the Web App URL — add `APPS_SCRIPT_URL` to the admin website's `api.js` config.
6. **Create n8n credentials** for Google Sheets, Drive, GitHub, OpenAI. Telegram credential left empty until end of build.
7. **Set the admin password** by running a one-time Apps Script function that hashes a password and writes the hash to Properties.
8. **At the very end:** register the Telegram bot via BotFather, get the token, paste into n8n's Telegram credential.

Each of these has a specific runbook step in `README.md` once that file is written.

---

## How to pick up cold (next-context handoff)

1. Read this file (you just did).
2. Read `.md/grooming-knowledge-software-architecture.md` v3.6 — it's the canonical spec including the §6.10 atomic publish ordering and §6.11 API contract.
3. Skim the approved plan at `C:\Users\FT Manager\.claude\plans\read-the-md-files-glimmering-glacier.md`.
4. Skim the two Plan agent outputs at `docs/data-api-design.md` and `docs/admin-workflows-design.md` (these will exist once Stage 2 Week 1 finishes; if they don't yet, the content is in the conversation transcript — check `C:\Users\FT Manager\.claude\projects\C--Users-FT-Manager-Desktop-Co-Work-Grooming-Software\<session-id>\tool-results\` for any persisted output files).
5. Check the "Current build state" section above for what's done vs pending.
6. Check `apps-script/` and `admin/` directories for what code exists.
7. Resume from the next pending todo. The "Pending (Stage 2 Week 1 day 1-2)" list above is the immediate work queue.

When in doubt about a design decision: spec v3.6 wins. When in doubt about implementation approach: check the agent design docs in `docs/`. When in doubt about user preference: check the memory files in `<.claude>/projects/.../memory/` (especially `feedback_*.md`).

---

## Update protocol for this file

Update this file:
- After every meaningful chunk of work (a stage milestone, a set of files written, a decision locked).
- When a spec amendment lands.
- When the user gives feedback that changes future work.
- At the end of every session before context approaches limit.

Keep this file ≤500 lines. Push deep detail to specialised docs (`docs/api.md`, `docs/data-api-design.md`, etc.) and link from here.
