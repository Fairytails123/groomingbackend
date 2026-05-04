# HANDOVER — Fairy Tails Grooming Knowledge Software

> **Read this in full before touching anything.** Then the spec at `.md/grooming-knowledge-software-architecture.md` (v3.8). Memory at `<.claude>/projects/.../memory/MEMORY.md` has user/feedback/reference notes that are authoritative for *how* to work on this project.
>
> **System state:** Stages 2–5 are live and verified. Stage 3 Phase 2 (browser-orchestrated PDF intake + AI extraction) is **deployed live as Web App Version 8** (`2026-05-04 10:46 UTC`) and **smoke-tested end-to-end on a real PDF** (`min sch.pdf`, Miniature Schnauzer, 5 pages). Three real bugs found and fixed during the smoke test — see §7 entries 8, 9, 10 below.

**Last updated:** 2026-05-04 — Phase 2 smoke-test session. `.gitattributes` added (commit `5b3a826`) to stop OneDrive CRLF flips. Three live bugs fixed and redeployed as Versions 6, 7, 8 of the Apps Script:
- v6: `max_tokens` → `max_completion_tokens` for gpt-5/o1/o3 model family (older models keep `max_tokens` + `temperature`).
- v7: vision user_content text now includes the word "JSON" — required by OpenAI when `response_format: { type: "json_object" }` is set.
- v8: vision `max_tokens` bumped 1024 → 8192 + `reasoning_effort: "low"` for gpt-5 (reasoning tokens were exhausting the output budget; vision is transcription-grade and doesn't need deep reasoning).
After v8: PRF-001 (Miniature Schnauzer / Pet Groom) extracted 14 vision findings on page 1, 4 on page 2, more on page 3 with blade numbers `#7F #5F #10 #15 #40` merged into the Body row. Status flipped to `Needs Review`. Apps Script Web App URL unchanged from prior deployments.

---

## 0. For a fresh Claude / Cowork session — first 5 minutes

1. **Read this file end-to-end.**
2. **Skim memory:** `<.claude>/projects/.../memory/MEMORY.md` (six entries, all short).
3. **Open the spec:** `.md/grooming-knowledge-software-architecture.md` v3.8, §0a "v3.8 amendments" block at the top is the diff-from-current-truth. Don't read the whole thing unless you need a specific section.
4. **Sanity check the live system:** `curl -s -o /dev/null -w "%{http_code}\n" https://fairytails123.github.io/groomingbackend/admin/login.html` should print `200`. Login URL + password in §"Live deployment state" below.
5. **Check git state:** `git log --oneline -10`. Last meaningful commit should be `e8c7d21 Docs: spec v3.7 + comprehensive HANDOVER rewrite`. Any newer commits should match what this file describes.
6. **Pick a task** from §"Recommended next-task priorities" — items are ranked by what unblocks the most.

**The single biggest pending item:** smoke-test Phase 2 with a real Adobe Scan PDF end-to-end. The deploy succeeded but the runtime hasn't been exercised. Everything else can wait behind that.

---

## 1. What this project is

Two connected pieces of software supporting a permanent **daily knowledge-building loop** for a UK dog grooming salon (Fairy Tails K9 Centre, Kamal). The morning's JotForm bookings drive what gets digitised; Kamal uploads breed-specific Adobe Scan PDFs via Telegram or the admin website; AI extracts text + Kamal snips diagrams from page renders; breeds go live on the salon TV before opening.

This repo (`Fairytails123/groomingbackend`) is the **back-end + admin website**. The TV display is a separate future build.

---

## 2. Live deployment state

Everything below is live unless flagged ⏳ pending or 🟡 not-yet-verified.

### Hosting & code

| What | Where |
|---|---|
| GitHub repo | https://github.com/Fairytails123/groomingbackend |
| GitHub Pages site | https://fairytails123.github.io/groomingbackend/ |
| Admin website (login) | https://fairytails123.github.io/groomingbackend/admin/login.html |
| Apps Script project | https://script.google.com/home/projects/1sxgzOrmd2OEmuJmMeoW15Vbb1GkbO1GIhs3h0afmOafcgOb1tDErvIA1/edit (project ID `1sxgzOrmd2OEmuJmMeoW15Vbb1GkbO1GIhs3h0afmOafcgOb1tDErvIA1`) |
| Apps Script Web App URL | `https://script.google.com/macros/s/AKfycby5CU8J-xyCn38ruoe_HdDswRBCNcxXLO9O2AyiiHDt781mwsJzWeyyahySfwjpq4ZL/exec` (deployment Version 5, persistent — same URL across all v1→v5 redeploys) |
| n8n workflow | https://ftmanager.app.n8n.cloud/workflow/6xHWEX3f9zrWtDDa ("Dog Grooming Back End") |

### Data + storage

| What | Where |
|---|---|
| Sheets workbook ("Grooming Backend") | https://docs.google.com/spreadsheets/d/1SZtkWUjXXgRIO5CzB_8NBeJ0_SEEq5k3IMAEPBZN01s/edit (ID `1SZtkWUjXXgRIO5CzB_8NBeJ0_SEEq5k3IMAEPBZN01s`) — **14 sheets populated** (13 original + `AI Call Log` added 2026-05-03) |
| Drive root folder ("Dog Grooming Back end") | https://drive.google.com/drive/folders/1Ry1YbBVhPwlvb6WFnsxiEBPvBzDDlNUk (ID `1Ry1YbBVhPwlvb6WFnsxiEBPvBzDDlNUk`) |
| Per-breed folders | Auto-created under root by `op_save_page_render` / `op_save_crop` / `op_upload_pdf` / publish flow |

### Apps Script Properties

```
ADMIN_PASSWORD_HASH      sha256(salt + plaintext)              ✅
ADMIN_PASSWORD_SALT      32-byte random                         ✅
SESSION_SECRET           32-byte random (HMAC tokens)           ✅
SPREADSHEET_ID           1SZtkWUjXXgRIO5CzB_8NBeJ0_SEEq5k3IMAEPBZN01s  ✅
DRIVE_ROOT_ID            1Ry1YbBVhPwlvb6WFnsxiEBPvBzDDlNUk      ✅
GITHUB_OWNER             Fairytails123                          ✅
GITHUB_REPO              groomingbackend                        ✅
JOTFORM_API_KEY          (set; value in .secrets/jotform-api-key.md)   ✅
JOTFORM_FIELD_BREED      26                                     ✅
JOTFORM_FIELD_DOG_NAME   9                                      ✅
JOTFORM_FIELD_APPT_TYPE  8                                      ✅
JOTFORM_FIELD_DATE_FG_BUS 3                                     ✅
JOTFORM_FIELD_DATE_FG_PRT 20                                    ✅
OPENAI_API_KEY           (set; value in .secrets/openai-api-key.md)    ✅ (added 2026-05-03)
```

⏳ **Pending Script Properties:**
- `GITHUB_PAT` — fine-grained PAT (Contents r/w on `Fairytails123/groomingbackend`). Until set: `op_publish_profile` fails with `GITHUB_FAILED`.
- `OPENAI_DAILY_CAP_GBP` — optional, default `5.0`. Soft cap on cumulative AI cost per UTC day.
- `OPENAI_USD_TO_GBP` — optional, default `0.85`. Conservative FX for cap math.

### Secrets (gitignored — `.secrets/`)

| File | Contents | Used in |
|---|---|---|
| `.secrets/telegram-token.md` | Bot token + group chat ID `-5072836532` | n8n Telegram credential (when WF-04/09 ship); future direct Apps Script Telegram sends |
| `.secrets/jotform-api-key.md` | JotForm API key | `JOTFORM_API_KEY` Property — already set |
| `.secrets/openai-api-key.md` | OpenAI API key (sk-proj-2O1U…ZaP8kA, provided 2026-05-03) | `OPENAI_API_KEY` Property — already set. Vision model = `gpt-5` |

These files are gitignored. Memory holds pointers to them, never the values.

### Login

- URL: https://fairytails123.github.io/groomingbackend/admin/login.html
- Password: `fairytails22` (chosen by Kamal; hashed in Apps Script Properties)

---

## 3. Authoritative docs

| Doc | What's in it |
|---|---|
| `.md/grooming-knowledge-software-architecture.md` | **Canonical spec, v3.8.** Sheets schema, Drive layout, API contract, atomic publish, all design decisions. §0a "v3.8 amendments" at top is the recent diff. |
| `.md/*.v3.[4-7].backup.md` | Earlier spec versions kept for historical context |
| `docs/HANDOVER.md` | This file — operational truth (what's live, what's pending, how to verify) |
| `docs/api.md` | Apps Script op catalogue — request/response shapes for every op |
| `docs/workflows.md` | n8n workflow catalogue (12 workflows + AI prompts + Telegram stubbing). Note: WF-06/07/08 are now deprecated for the Phase 2 path — see spec §0a v3.8 amendments. |
| `<.claude>/plans/read-analyse-and-get-iterative-pond.md` | Stage 3 Phase 2 implementation plan (the one that produced what's now live) |
| `<.claude>/projects/.../memory/` | Cross-session memory — user, feedback, reference notes |

---

## 4. What's done — feature checklist

Every row links the relevant commit so a `git show` brings up the diff.

### Stage 2 — admin editor + JotForm session pack

- ✅ Repo scaffolded, brand CSS, login flow (`bbad832`)
- ✅ Profile editor with TEXT/IMAGES/DISPLAY/HISTORY tabs, debounced autosave, blade-pill UI; groom-types CRUD; `setup.gs` bootstrapper (`a722812`)
- ✅ GitHub Contents API publish; image upload + publish admin pages (`b1db963`)
- ✅ Quick-add-or-update breed card on dashboard with autocomplete (`dbc1352`)

### Stage 3 — snipping tool

- ✅ **Phase 1**: Cropper.js v1.6.2 vendored; `snip.html` with filmstrip + canvas + role buttons (M/F/B/H/S keyboard shortcuts); `crops.gs` with `op_list_page_renders`, `op_save_page_render`, `op_save_crop`, `op_list_crops_for_render` (`9626999`)
- ✅ Drive serving fixed: switched to `lh3.googleusercontent.com/d/<id>=s0` URLs + auto-public sharing on upload + `makeAllImagesPublic()` retro-fix helper (`bff73b3`)
- ✅ IMAGES tab on profile editor lists real page-render + image counts with thumbnails (`5e0427e`)
- ✅ **Phase 2 deployed live as Web App v5 (2026-05-03)** — code complete, deploy verified, **runtime not yet exercised end-to-end with a real PDF (🟡 next session)**.
  - Vendored pdf.js v4.6.82 (`vendor/pdfjs/pdf.min.mjs` + `pdf.worker.min.mjs`)
  - `admin/js/pdf.js` renders each page to JPEG + extracts text via pdf.js
  - `admin/js/pdf-intake.js` orchestrator: upload → render → save renders → extract → vision per page → finalize
  - `admin/upload.html` two-tab UI (PDF intake / Image upload) with progress panel + log scroller
  - `admin/js/api.js` extended with per-call `opts.timeoutMs` so AI ops can take 60-90s
  - `admin/js/ui.js` `formDialog` extended with `type:"textarea"` field support (used by heading edit modal)
  - `apps-script/pdfs.gs`: `op_upload_pdf`, `op_get_source_pdf`, `op_finalize_pdf_intake`
  - `apps-script/ai.gs`: `callOpenAI_` wrapper, WF-06 + WF-08 prompts as constants, `op_extract_sections` (`gpt-4o-mini`), `op_run_vision_pass_page` (`gpt-5` — best-in-class vision), `op_list_pending_headings`, `op_decide_heading`, daily cost cap (`assertCostCapNotExceeded_`)
  - `apps-script/lib/alerts.gs`: `logOperationalAlert_` helper
  - `apps-script/setup.gs`: schema for new `AI Call Log` sheet + `suggested_text` column on Extra Heading Approvals (auto-applied by re-running `setupAll`; already done)
  - `apps-script/ids.gs`: new ID kind `ai_call: "AIC"`
  - Profile editor IMAGES tab: inline "Pending heading approvals" card (Approve / Edit & Approve / Ignore) + "Re-extract sections" button (round-trips PDF via `op_get_source_pdf` + `sessionStorage` + redirect to `upload.html?reextract=1`)
  - WF-04 (Telegram intake) and WF-09 (Telegram heading approval) **deferred** — Sheet 6 schema is the same, so the Telegram path can drop in unchanged later.

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
- ⏳ Cron HTTP Request nodes have placeholder for Apps Script URL (Kamal pastes the actual URL `…/AKfycby5CU8J-xyCn38ruoe_HdDswRBCNcxXLO9O2AyiiHDt781mwsJzWeyyahySfwjpq4ZL/exec` into all three)
- ⏳ No credentials wired yet (Sheets/Drive OAuth, GitHub HTTP Header Auth, OpenAI for Phase 2, Telegram from `.secrets/`)

---

## 5. Recommended next-task priorities

Items ranked by what unblocks the most. Pick one, finish it, update this section.

### P0 — Phase 2 real-PDF smoke test (🟡 not yet done)

Code is deployed but never run end-to-end with a real Adobe Scan PDF. This is the riskiest unverified path. Walk it before touching anything else.

1. Open https://fairytails123.github.io/groomingbackend/admin/login.html, log in (`fairytails22`).
2. Library → ensure Miniature Schnauzer (or any breed Kamal has a real PDF for) exists with a `Pet Groom` profile.
3. Open `/admin/upload.html` → click "PDF intake" tab → pick the breed → drop the real PDF → click "Start extraction".
4. Watch the progress panel. Expected sequence: Upload PDF → Render pages (per-page progress) → Save page renders (per-page progress) → Extract text + structure (gpt-4o-mini, ~10s) → Vision pass (gpt-5 per page, ~5-15s each) → Finalize. Tab must stay open.
5. On success → click "Open profile →". TEXT tab should show the 5 core sections populated with `ai_confidence`. IMAGES tab should show N page-render thumbnails + a "Pending heading approvals" card if AI suggested any extras.
6. Snip a body diagram → save as `main`. Verify the image lands in Sheet 4 (Images).
7. Approve one suggested heading → confirm a new section appears in TEXT tab. Ignore another → confirm it disappears from pending.
8. Cost-cap test: temporarily set `OPENAI_DAILY_CAP_GBP=0.001` Property → click "Re-extract sections" → expect a `QUOTA_EXCEEDED` toast and an Operational Alerts row severity=error. Restore the cap.
9. Failure-injection test: temporarily corrupt `OPENAI_API_KEY` (suffix random chars) → re-extract → expect status stays `Processing`, `error_message` set, alert logged. Restore the key.
10. Open `AI Call Log` sheet → verify one row per OpenAI call with token counts and `cost_usd` populated.

If any step fails, debug via DevTools (Network tab catches Apps Script responses; Console catches client errors). Apps Script editor → Execution log shows server-side stack traces.

When all green: commit the verification result (`docs/HANDOVER.md` flag flips from 🟡 to ✅), push.

### P1 — Phase A: Kamal-side wiring (~30 min, mostly Kamal's hands)

1. **`GITHUB_PAT`**: Settings → Developer settings → Fine-grained tokens → scope `Fairytails123/groomingbackend`, Contents r/w + Metadata r → paste into Apps Script Property `GITHUB_PAT`. Then smoke-test publish: log in, edit a profile, click Publish on `/admin/publish.html`, verify `public/breeds/<slug>.json` lands on GitHub Pages.
2. **n8n Apps Script URL placeholders**: open the workflow at https://ftmanager.app.n8n.cloud/workflow/6xHWEX3f9zrWtDDa, paste the URL `https://script.google.com/macros/s/AKfycby5CU8J-xyCn38ruoe_HdDswRBCNcxXLO9O2AyiiHDt781mwsJzWeyyahySfwjpq4ZL/exec` into all three HTTP Request nodes, save, activate.
3. **n8n Credentials**: create Google Sheets OAuth, Google Drive OAuth, HTTP Header Auth for GitHub (header `Authorization`, value `Bearer <PAT>`), OpenAI API (key — only needed if you ever revive the n8n WF-06/07/08 path; the live path uses Apps Script direct).
4. **Midnight time trigger** for `resetLoginFailCounter`: Apps Script editor → Triggers → Add Trigger → Function `resetLoginFailCounter`, Event source `Time-driven`, Type `Day timer`, Time `Midnight to 1am`. Stops the brute-force counter from accumulating forever.
5. **JotForm webhook → n8n WF-01** (so `today.json` rebuilds within seconds of a new booking, not just on the 06:00 / 11:30 cron). JotForm form `251190647924057` → Settings → Integrations → Webhooks → add the n8n webhook URL.

### P2 — `clasp login` so future deploys are one command

`clasp` v3.3.0 is installed globally; `~/.clasprc.json` doesn't exist yet. Run `clasp login` in a terminal, authorise Google, then redeploys become `clasp push && clasp deploy --deploymentId AKfycby5CU8J-xyCn38ruoe_HdDswRBCNcxXLO9O2AyiiHDt781mwsJzWeyyahySfwjpq4ZL` instead of the Chrome MCP Monaco pasting path. See `<.claude>/projects/.../memory/reference_apps_script_deploy.md`.

### P3 — small follow-ups (any order, when you have a slice)

- **`op_acknowledge_alert`** — Operational Alerts panel on the dashboard surfaces alerts but has no clear path. Add a small op + button.
- **Spec amendments back-fold** — every time you make a non-trivial decision, append a numbered entry to `.md/grooming-knowledge-software-architecture.md` §0a "v3.8 amendments" block. Bump to v3.9 when there are >3 new entries.
- **Server-side cropping** (n8n + Pillow / WF-10) — replace client-side `canvas.toDataURL()` for byte-perfect crops. Only do this if you actually see image-quality issues; current path is fine for personal-scale.
- **Apps Script doGet image proxy** with token gating — current path makes Drive page-render and crop files publicly viewable by URL (image-id-based filenames are unguessable as a soft barrier). Do this if Kamal ever wants stricter isolation.

### P4 — Stage 3 Phase 2 follow-ons (deferred from scope)

- **WF-04 Telegram intake** — bot token already in `.secrets/telegram-token.md`. Reuses the existing `op_upload_pdf` + `op_extract_sections` + `op_run_vision_pass_page` chain. n8n → on bot message with PDF document → `getFile` → upload to Drive → call `op_upload_pdf` → fire downstream chain.
- **WF-09 Telegram heading approval** — n8n → on Phase 2 finalize → if `extra_headings_pending > 0`, send Telegram message with inline buttons → callback writes to Sheet 6 with the same shape `op_decide_heading` writes (so the inline UI keeps working too).
- **Cost guard rails for n8n path** — if WF-06/07/08 ever revive (they're deprecated for Phase 2 but kept as fallback), they should call `op_extract_sections` / `op_run_vision_pass_page` rather than calling OpenAI themselves, so the Apps Script `AI Call Log` + cost cap stays single-source-of-truth.

### P5 — TV display

Out of scope for this repo. When ready: new repo `Fairytails123/grooming-display`, vanilla HTML/JS PWA, reads `public/today.json` + `public/breeds/*.json` from this repo's GitHub Pages.

---

## 6. How to verify the system is healthy (cheat-sheet)

| Check | Command / step | Expected |
|---|---|---|
| GitHub Pages alive | `curl -s -o /dev/null -w "%{http_code}\n" https://fairytails123.github.io/groomingbackend/admin/login.html` | `200` |
| Apps Script Web App reachable | The Web App URL serves a 302 to a `script.googleusercontent.com` echo URL on plain GET — that's normal Google interstitial behaviour. Easiest dispatcher check: log in via the admin site → DevTools Network tab → any successful op (e.g. `list_breeds`) shows `ok:true`. |
| Login works | Visit login URL, password `fairytails22` | Lands on dashboard |
| Sheets accessible | Open the Sheets workbook URL | 14 sheets visible (last sheet should be `AI Call Log`) |
| Drive root accessible | Open Drive root folder URL | One subfolder per breed digitised so far |
| Phase 2 ops registered | Admin site → DevTools Console → `(await fetch("https://script.google.com/macros/s/AKfycby5CU8J-xyCn38ruoe_HdDswRBCNcxXLO9O2AyiiHDt781mwsJzWeyyahySfwjpq4ZL/exec",{method:"POST",headers:{"Content-Type":"text/plain"},body:'{"op":"extract_sections"}'})).json()` | `{ok:false, error:{code:"UNAUTHORIZED",…}}` — op exists, no auth_token. NOT `code:"NOT_FOUND"` (which would mean the OP_REGISTRY isn't picking up the new op). |

---

## 7. Bugs fixed during this build (don't reintroduce)

In chronological order; only the ones that left a trap if you're not careful.

1. **clasp create overwrote `appsscript.json`** — clasp's "Cloned one file" step pulls the project's default manifest down. Lesson: after `clasp create`, `git checkout HEAD -- appsscript.json` before `clasp push`.

2. **JotForm EU Safe-mode 301 redirect** — `api.jotform.com` returns 301 to `eu-api.jotform.com` that UrlFetchApp doesn't follow cleanly. Default base URL is now `eu-api.jotform.com`; override via Property `JOTFORM_API_BASE` for non-EU accounts (`2080665`).

3. **JotForm appt-type filter matched zero submissions** — exact-string `Set` against idealised labels failed because real options use different em-dashes/casing. Now substring-based: contains "full groom" or "hand strip" AND not "bath" / "teeth" (`b039958`).

4. **Snipping tool images 403'd (CRITICAL)** — `<img crossorigin="anonymous">` strips auth cookies → Drive returns 403 for private files. Fix: serve via `lh3.googleusercontent.com/d/<id>=s0` (Google Photos CDN, CORS-permissive); make every uploaded page-render and crop publicly shared on creation (`makeFilePublicForServing_` in `crops.gs`); one-shot `makeAllImagesPublic()` retro-fits old files (already run). Trade-off: Drive files publicly viewable by URL — image-id-based filenames are an unguessable soft barrier (`bff73b3`).

5. **Profile IMAGES tab stale "ships in Stage 3" text** — replaced with real listings of page renders + cropped images, lazy-loaded on tab switch (`5e0427e`).

6. **Apps Script "Authorization required" popup unclickable from Chrome MCP** — first-run OAuth consent opens in a separate Chrome window outside the MCP tab group. Lesson: any first-run Apps Script function that touches Drive/Sheets needs Kamal to click through the consent dialog once.

7. **clasp not installed locally during Phase 2 deploy session (2026-05-03)** — terminal had no `clasp`. Solution adopted: install via `npm install -g @google/clasp`, but `clasp login` still needed. Pivoted to Chrome MCP + Monaco's exposed `setValue` API to push files directly, then "Manage deployments → edit pencil → New version" UI flow to redeploy in place. See memory `reference_apps_script_deploy.md` for the full technique. Lesson: don't assume CLI tools are wired; ask before halting on a tooling gap.
8. **OpenAI gpt-5 chat completions reject `max_tokens` (2026-05-04 smoke test).** First Phase 2 vision pass against `min sch.pdf` failed 4/4 pages with `OpenAI HTTP 400: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead."`. Older models (gpt-3.5/4/4o/4o-mini) accept `max_tokens`; reasoning-class models (gpt-5*, o1*, o3*) require `max_completion_tokens` and reject custom `temperature`. `callOpenAI_` in `apps-script/ai.gs` now branches on `/^(gpt-5|o1|o3)/i.test(model)` and shapes the payload accordingly. Deployed Apps Script v6.

9. **OpenAI `response_format: json_object` requires the literal word "json" in messages (2026-05-04 smoke test).** With bug #8 fixed, vision call returned `OpenAI HTTP 400: "'messages' must contain the word 'json' in some form, to use 'response_format' of type 'json_object'."`. The `WF08_SYSTEM_PROMPT` showed JSON syntax in the example but never used the word "JSON" in prose, and the user_content text was just `Page N of the source PDF.`. Fix: `op_run_vision_pass_page` now passes `Return JSON findings for page ${pageIndex} of the source PDF.` Lesson: when using `response_format: json_object`, ensure the system *or* user message contains the literal substring "json"; OpenAI rejects messages that don't. Deployed Apps Script v7.

10. **gpt-5 reasoning tokens exhaust `max_completion_tokens` budget (2026-05-04 smoke test).** With bugs #8 and #9 fixed, vision returned 200 OK but `message.content` was empty/non-JSON because gpt-5's reasoning tokens consumed the entire 1024-token budget before any visible output. Two-part fix: (a) bumped `op_run_vision_pass_page` `max_tokens` from 1024 → 8192; (b) added `payload.reasoning_effort = "low"` inside the gpt-5 branch in `callOpenAI_` since vision transcription doesn't need deep reasoning. After v8: PRF-001 vision pass produced 14 + 0 + 4 + N findings on the four page renders, with blade numbers `#7F #5F #10 #15 #40` merged into the Body row. Lesson: reasoning models budget reasoning + output from the same `max_completion_tokens` pool — reasoning-light tasks should set `reasoning_effort: "low"` and keep generous max budgets. Deployed Apps Script v8.

11. **OneDrive Files-On-Demand dehydrates `.git` objects (2026-05-04 cold-start session).** Fresh Cowork session reported `fatal: loose object 5bbb205... is corrupt` and 138 of 311 files showed `Blocks: 0` from the Linux mount. Files weren't really corrupt — OneDrive had freed up disk by replacing them with cloud-only placeholders, but the Linux WSL mount can't trigger hydration. Fix: right-click the repo folder → "Always keep on this device" rehydrates everything. Recommended long-term fix: move the repo out of OneDrive entirely (git + GitHub is already the source of truth and off-machine backup; OneDrive on top is redundant and dangerous). Same session also found a CRLF/LF flip across 9 files (no `.gitattributes`); fixed by adding `.gitattributes` with `* text=auto eol=lf` (commit `5b3a826`). Lesson: do not put git repos under OneDrive without `.gitattributes` and "Always keep on this device" pinned.

12. **Edit tool truncates files when the working file lives in OneDrive (2026-05-04).** During the Phase 2 fix session, two separate `Edit` tool calls on `apps-script/ai.gs` produced files that were truncated mid-function (e.g. `section_order: maxOrder +` ending mid-expression). The targeted change had landed near the top, but the bottom of the file lost ~28 lines. Workaround: backup before edit, do edits via `mcp__workspace__bash` `sed -i` (atomic in-place writes), and verify line count + tail + `node --check` immediately after. Lesson: when editing a file inside OneDrive, prefer bash sed over Edit tool for any change beyond a couple of lines. Better long-term: move repo out of OneDrive (see bug #11).


---

## 8. How a fresh session should pick up cold

1. **Read this file in full** (you just did).
2. **Read memory:** `<.claude>/projects/.../memory/MEMORY.md` index, then any of the six entries that look relevant.
3. **Spec read:** §0a "v3.8 amendments" at the top of `.md/grooming-knowledge-software-architecture.md`. Don't read the whole spec unless you need a specific section.
4. **Verify alive:** the cheat-sheet in §6 above.
5. **Check git state:** `git log --oneline -10`. The Phase 2 work is in the local working tree but **not yet committed** as of this session — see `git status`. Consider creating a single commit for the Phase 2 ship before doing anything else, with a message like `Stage 3 Phase 2 ship: browser-orchestrated PDF intake + AI extraction (deployed v5)`.
6. **If user asks about a feature that "should already work":** check §4 "What's done". If it's marked ✅ and the file mentioned exists locally, the feature is live (modulo GitHub Pages cache; hard-refresh).
7. **If user reports a bug:** check §7 "Bugs fixed" first — don't reintroduce. If novel: drive Chrome MCP to reproduce (memory `reference_apps_script_deploy.md` has the techniques), use `mcp__Claude_in_Chrome__javascript_tool` to inspect state, fix, push.
8. **For new work:** respect the design-first feedback (`feedback_design_first.md`) — for non-trivial changes, 