# HANDOVER — Fairy Tails Grooming Knowledge Software

> **Read this in full before touching anything.** Then the spec at `.md/grooming-knowledge-software-architecture.md` (v3.10). Memory at `<.claude>/projects/.../memory/MEMORY.md` has user/feedback/reference notes that are authoritative for *how* to work on this project.
>
> **System state — Stage 1 TV display LIVE.** Full architecture-spec loop now closed end-to-end: TV at `https://fairytails123.github.io/groomingtv/` (Stage 1) reads from the back end at `https://fairytails123.github.io/groomingbackend/` (Stages 2–5 + Phase 2). Apps Script Web App at Version 10 (`2026-05-04 12:41 UTC`). Spec at v3.10.

**Last updated:** 2026-05-05 — TV display ship session. Back-end commit `e249143`, TV repo initial commit `345d03c`.

Earlier same-day work folded in:
- v6: `max_tokens` → `max_completion_tokens` for gpt-5/o1/o3 model family (older models keep `max_tokens` + `temperature`).
- v7: vision user_content text now includes the word "JSON" — required by OpenAI when `response_format: { type: "json_object" }` is set.
- v8: vision `max_tokens` bumped 1024 → 8192 + `reasoning_effort: "low"` for gpt-5 (reasoning tokens were exhausting the output budget; vision is transcription-grade and doesn't need deep reasoning).
- v9: `op_acknowledge_alert` added (dashboard Dismiss button on Operational Alerts).
- v10: `op_health_check` added (dashboard "Backend health" card surfacing wiring state, sheet counts, today's AI spend, last AI call).

After v10:
- `GITHUB_PAT` Script Property set; verified end-to-end via test publish of PRF-001 → wrote 1 pack JSON + 7 image commits to `Fairytails123/groomingbackend@main`.
- Apps Script `setupTriggers()` ran; midnight `resetLoginFailCounter` trigger installed.
- n8n cron HTTP Request URLs pasted into all 3 nodes of "Dog Grooming Back End" workflow.
- WF-04 Telegram intake workflow built into the same n8n workflow as a 14-node chain (Telegram Trigger → IF chat-id → IF document → stash-or-route → upload chain → success/error replies). Two-message protocol (PDF first, then PRF-XXX as a separate text). State persists across n8n executions via `$getWorkflowStaticData('global').pendingPdfs[chatId]`.
- `admin/js/pages/upload.js` gains `tryReextractFromUrl(profileId)` — `/admin/upload.html?reextract=1&pid=PRF-XXX` (or `profile_id=` / `profileid=` for back-compat) fetches the source PDF via `op_get_source_pdf` and auto-runs the intake pipeline. Used by the WF-04 success reply for one-click extraction from Telegram.
- `apps-script/Code.gs` doPost accepts `service_token` as an alternative to `auth_token` for n8n calls (matches the Property `SERVICE_TOKEN`).
- **`admin/js/pages/profile.js` `onPublish()` no longer a stub.** Real publish flow: flush autosave → confirm dialog → `op_publish_profile` (120s timeout) → friendly toasts for VALIDATION_FAILED / GITHUB_FAILED / CONFLICT → reload state on success.

After v8: PRF-001 (Miniature Schnauzer / Pet Groom) extracted 14 vision findings on page 1, 4 on page 2, more on page 3 with blade numbers `#7F #5F #10 #15 #40` merged into the Body row. Status flipped to `Needs Review`. Re-extract now catches up on missing page renders (bug #25 fix in `admin/js/pdf-intake.js`). Apps Script Web App URL unchanged from prior deployments.

---

## 0. For a fresh Claude / Cowork session — first 5 minutes

1. **Read this file end-to-end.**
2. **Skim memory:** `<.claude>/projects/.../memory/MEMORY.md` (six entries, all short).
3. **Open the spec:** `.md/grooming-knowledge-software-architecture.md` v3.9, §0a "v3.9 amendments" block at the top is the diff-from-current-truth. Don't read the whole thing unless you need a specific section.
4. **Sanity check the live system:** `curl -s -o /dev/null -w "%{http_code}\n" https://fairytails123.github.io/groomingbackend/admin/login.html` should print `200`. Login URL + password in §"Live deployment state" below.
5. **Check git state:** `git log --oneline -10`. Last meaningful commit (this session): `93a2ce1 Wire Publish button on profile page to op_publish_profile`. Earlier in same day: `35229b4 WF-04 Telegram-safe URL param`, `364b67c WF-04 Telegram intake live + service-token`. Any newer commits should match what this file describes.
6. **Pick a task** from §"Recommended next-task priorities" — items are ranked by what unblocks the most.

**The single biggest pending item:** ✅ DONE — Phase 2 smoke-tested end-to-end with `min sch.pdf` (Miniature Schnauzer). Publish chain verified via commit `906d0756`. Next biggest item: pick from §5 priorities (recommended: P0 = move repo out of OneDrive).

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
| Back-end GitHub repo | https://github.com/Fairytails123/groomingbackend |
| Back-end GitHub Pages site | https://fairytails123.github.io/groomingbackend/ |
| Admin website (login) | https://fairytails123.github.io/groomingbackend/admin/login.html |
| **TV display GitHub repo** | https://github.com/Fairytails123/groomingtv |
| **TV display live URL** | https://fairytails123.github.io/groomingtv/ — open on the salon Hisense 40" 40E4QTUK Vidaa browser. Reads `today.json` + `breeds/{slug}.json` + `index.json` from the back-end Pages site. Local working copy at `C:\Users\FT Manager\OneDrive\Business\CODING\groomingtv\` |
| Apps Script project | https://script.google.com/home/projects/1sxgzOrmd2OEmuJmMeoW15Vbb1GkbO1GIhs3h0afmOafcgOb1tDErvIA1/edit (project ID `1sxgzOrmd2OEmuJmMeoW15Vbb1GkbO1GIhs3h0afmOafcgOb1tDErvIA1`) |
| Apps Script Web App URL | `https://script.google.com/macros/s/AKfycby5CU8J-xyCn38ruoe_HdDswRBCNcxXLO9O2AyiiHDt781mwsJzWeyyahySfwjpq4ZL/exec` (deployment Version 10, persistent — same URL across all v1→v10 redeploys) |
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
| `.md/grooming-knowledge-software-architecture.md` | **Canonical spec, v3.9.** Sheets schema, Drive layout, API contract, atomic publish, all design decisions. §0a "v3.9 amendments" at top is the recent diff. |
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
- ✅ **Phase 2 deployed and verified end-to-end (2026-05-04)** — Web App v10. Smoke-tested with `min sch.pdf` Miniature Schnauzer 5-page Adobe Scan. Bugs #8/#9/#10 fixed in flight. Publish chain confirmed via commit `906d0756 Publish Miniature Schnauzer / Pet Groom v15`.
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
- ✅ Cron HTTP Request nodes all hold the live URL `…/AKfycby5CU8J-xyCn38ruoe_HdDswRBCNcxXLO9O2AyiiHDt781mwsJzWeyyahySfwjpq4ZL/exec`
- ✅ Credentials wired: Telegram bot creds (`Telegram groomingbackend` from `.secrets/telegram-token.md`), HTTP Header Auth for SERVICE_TOKEN

### n8n WF-04 — Telegram intake (live, this session)

- ✅ **Two-message protocol.** Telegram mobile doesn't expose a caption field on document send, so the original "send PDF with `PRF-XXX` caption" design doesn't work. The shipping flow is: send the PDF → bot replies "got it, now send `PRF-XXX`" → user sends `PRF-XXX` as plain text → bot uploads PDF + replies with one-click reextract URL.
- ✅ **State correlation** via `$getWorkflowStaticData('global').pendingPdfs[chatId]`. Stash on PDF arrival, drain on `PRF-XXX` arrival, clear after successful upload.
- ✅ **Binary handling.** Uses `await this.helpers.getBinaryDataBuffer(0, binaryName)` not `binary.data` (n8n cloud uses `filesystem-v2` storage; the literal string `'filesystem-v2'` is what `binary.data` holds, not the bytes).
- ✅ **One-click re-extract URL** in the success reply: `https://fairytails123.github.io/groomingbackend/admin/upload.html?reextract=1&pid=PRF-XXX`. Uses `pid=` (no underscores) because Telegram silently interprets `_` in plain text as italic markers and strips them — see bug #13.
- ✅ **`tryReextractFromUrl()`** in `admin/js/pages/upload.js` accepts `profile_id`, `profileid`, OR `pid` URL params (defensive — survives Telegram mangling either way).

### Service-token Apps Script branch

- ✅ `apps-script/Code.gs` doPost accepts `body.service_token` matching the `SERVICE_TOKEN` Script Property as an alternative to a HMAC session token. n8n holds the secret in an HTTP Header Auth credential and forwards it on every call. Means n8n doesn't need an admin login session and Kamal's password rotations don't break the bot.
- ✅ `apps-script/setup.gs` `setupServiceToken()` generates a 32-byte random token and writes it to `SERVICE_TOKEN` Property (idempotent — only writes if missing).

---

## 5. Recommended next-task priorities

Items ranked by what unblocks the most. Pick one, finish it, update this section.

### P0 — Move repo out of OneDrive (~10 min, blocks nothing but pays back forever)

OneDrive on top of `.git` is the cause of the recurring lock-file fights, the Edit-tool truncation (bug #12), the CRLF flip (bug #11), and the dehydration risk. The git remote on GitHub already gives you off-machine backup. Moving to a plain local folder costs you OneDrive sync of the source tree but you don't need that — git is the cross-machine sync layer.

Recommended location: `C:\dev\groomingbackend\`.

Steps:
1. **Push everything from the OneDrive copy first.** `git status` clean, `git push origin main` — make sure no local-only commits.
2. In a new PowerShell: `cd C:\ ; mkdir dev ; cd dev ; git clone https://github.com/Fairytails123/groomingbackend.git`. This becomes your new working copy.
3. Sign in to https://github.com/settings/personal-access-tokens — your existing fine-grained PAT (`groomingbackend (publish)`) works for `git clone`/`push` from any machine.
4. Open Cowork on the new path; set `request_cowork_directory` to `C:\dev\groomingbackend`. The `.secrets/`, `.md/`, and `outputs/` paths inside the repo all stay relative.
5. Once the new clone works, **rename the OneDrive copy** to `groomingbackend.OLD-do-not-edit` so you don't accidentally edit the wrong tree. Don't delete it for a few days.
6. The laptop sees this same git remote — it's a `git clone` away from being identical.

### P1 — Phase A: Kamal-side wiring (mostly DONE)

1. ✅ **`GITHUB_PAT`** set; publish flow verified end-to-end (commits `12020ed` and `906d0756` on origin written by Apps Script).
2. ✅ **n8n Apps Script URL placeholders** filled in across all three cron HTTP Request nodes.
3. ✅ **n8n Credentials** — Telegram bot, HTTP Header Auth (SERVICE_TOKEN). Sheets/Drive OAuth + OpenAI **not needed** for the live path (Apps Script holds OPENAI_API_KEY directly; WF-06/07/08 are deprecated).
4. ✅ **Midnight time trigger** for `resetLoginFailCounter` installed via `setupTriggers()` (programmatic) — see `apps-script/setup.gs`.
5. ⏳ **JotForm webhook → n8n WF-01** — still pending; current daily flow falls back to the 06:00 / 11:30 cron for `today.json` rebuilds. Optional polish; not blocking.

### P2 — `clasp login` so future deploys are one command

`clasp` v3.3.0 is installed globally; `~/.clasprc.json` doesn't exist yet. Run `clasp login` in a terminal, authorise Google, then redeploys become `clasp push && clasp deploy --deploymentId AKfycby5CU8J-xyCn38ruoe_HdDswRBCNcxXLO9O2AyiiHDt781mwsJzWeyyahySfwjpq4ZL` instead of the Chrome MCP Monaco pasting path. See `<.claude>/projects/.../memory/reference_apps_script_deploy.md`.

### P3 — small follow-ups (any order, when you have a slice)

- ✅ **`op_acknowledge_alert`** — done in v9 (Dismiss button on Operational Alerts panel).
- **Spec amendments back-fold** — current spec is **v3.9**. Every non-trivial decision should append a numbered entry to `.md/grooming-knowledge-software-architecture.md` §0a "v3.9 amendments" block. Bump to v4.0 when there are >3 new entries since v3.9 was minted.
- **Server-side cropping** (n8n + Pillow / WF-10) — replace client-side `canvas.toDataURL()` for byte-perfect crops. Only do this if you actually see image-quality issues; current path is fine for personal-scale.
- **Apps Script doGet image proxy** with token gating — current path makes Drive page-render and crop files publicly viewable by URL (image-id-based filenames are unguessable as a soft barrier). Do this if Kamal ever wants stricter isolation.

### P4 — Stage 3 Phase 2 follow-ons

- ✅ **WF-04 Telegram intake** — built and verified end-to-end this session. Two-message protocol; one-click re-extract URL in success reply.
- ⏳ **WF-09 Telegram heading approval** — still deferred. n8n → on Phase 2 finalize → if `extra_headings_pending > 0`, send Telegram message with inline Approve / Edit / Ignore buttons → callback writes to Sheet 6 with the same shape `op_decide_heading` writes (so the inline UI keeps working in parallel). The two-message-correlation pattern from WF-04 is the template.
- **Auto-extract trigger on `?reextract=1` URLs** — eliminate the one-click "Start extraction" step on `upload.html?reextract=1&pid=PRF-XXX` so the Telegram → publish loop is fully hands-off after the user snips diagrams. Currently `tryReextractFromUrl()` populates the breed select and PDF blob; we just need to also call `runIntakeWithUi()` immediately when `auto=1` is in the URL.
- **Cost guard rails for n8n path** — if WF-06/07/08 ever revive (they're deprecated for Phase 2 but kept as fallback), they should call `op_extract_sections` / `op_run_vision_pass_page` rather than calling OpenAI themselves, so the Apps Script `AI Call Log` + cost cap stays single-source-of-truth.

### P5 — TV display ✅ DONE (2026-05-05)

Shipped as a separate repo at `https://github.com/Fairytails123/groomingtv` (initial commit `345d03c`). Live at `https://fairytails123.github.io/groomingtv/`. Vanilla HTML / ES modules / no build step; tokens scaled for the salon's actual TV (Hisense 40" 40E4QTUK FHD, 1920×1080, Vidaa browser). Reads `today.json` + `breeds/{slug}.json` + `index.json` from the back-end's GitHub Pages.

**Open follow-ups:**
- **Live verification on the actual Hisense TV.** Desktop Chrome rendering passed; Vidaa is the load-bearing test. Plug a Fire TV Stick at the same URL if Vidaa is too quirky.
- **Apps Script redeploy** so `writePublicIndex_()` (in `apps-script/publish.gs`, commit `e249143`) fires on every future publish. Until then `public/index.json` is maintained manually (currently has BRD-001 Miniature Schnauzer; rerun `rebuildPublicIndex()` from the editor after redeploy to refresh, or hand-edit on the next breed publish).
- **Service worker / offline cache + PWA manifest** — deferred until Vidaa rendering is confirmed (spec §0a #43).

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

13. **Telegram silently strips underscores in plain-text URLs (2026-05-04 evening).** First version of WF-04 success reply included `https://…/upload.html?reextract=1&profile_id=PRF-001`. On the user's mobile Telegram client, the URL rendered as `…?reextract=1&profileid=PRF-001` because `_id` was being parsed as italic markup (`_..._`). Symptom: clicking the link landed on `/admin/upload.html` but `tryReextractFromUrl(null)` was called and the page sat empty. Fix: WF-04 now ships the URL with a fully underscore-free key (`pid=` — short for profile id), and `tryReextractFromUrl` accepts `profile_id`, `profileid`, OR `pid` to be defensive against past Telegram quirks too. Lesson: any URL that travels through Telegram plain text must contain zero underscores in keys or values — use kebab-case or short keys.

14. **`onPublish()` was a stub that swallowed clicks (2026-05-04 evening).** `admin/js/pages/profile.js` had `async function onPublish() { await saveNow(); toast("Publish flow lands in Stage 2 Week 3 — save was applied."); }`. Misread by Kamal as "stage 2 of 3" + "nothing is published". Confirmed by API state: `last_publish_succeeded_at` was hours-stale despite the click. Fixed in commit `93a2ce1` — now flushes autosave debounce, confirms with the user, calls `op_publish_profile` (120s timeout), handles `VALIDATION_FAILED` / `GITHUB_FAILED` / `CONFLICT`, and reloads on success. Verified end-to-end: commit `906d0756 Publish Miniature Schnauzer / Pet Groom v15` was created by Apps Script as a result of the click. Lesson: stub strings that say "Stage X Week Y" can be misread as progress indicators by users; either remove the stub or make the message obviously a TODO.

15. **Browser cache traps for ES modules (2026-05-04 evening).** After bug #14 was fixed and pushed (commit `93a2ce1`), Kamal's regular Chrome tab continued running the old `profile.js` even after Ctrl+Shift+R. ES module imports cache aggressively beyond what hard-refresh clears. Two reliable fixes: (a) DevTools (F12) → Application tab → **Clear site data** button — wipes service worker + all caches + sessionStorage in one shot; (b) DevTools → Network tab → **Disable cache** while DevTools is open + reload. Incognito always serves fresh, useful as a sanity check. Lesson: when telling the user "now hard-refresh", lead with "DevTools → Clear site data" instead. Note this affects every code change to `admin/js/`, so factor it into smoke-test scripts.

16. **Stale `.git/index.lock` on OneDrive cannot be removed by Linux (2026-05-04 evening, recurring).** When git is interrupted (or when OneDrive sync is mid-flight) the index lock can be left behind. The Linux mount inside the Cowork sandbox sees the file but `rm -f` returns "Operation not permitted" because of OneDrive's Windows ACL. Fix: from PowerShell, `if (Test-Path .git\index.lock) { Remove-Item -Force .git\index.lock }`. Sometimes git itself re-creates the lock during a write; then run the same Remove-Item between failed `git add` invocations. Lesson: `git` operations on the OneDrive copy are fragile; the proper fix is bug #11's recommendation — move the repo to `C:\dev\groomingbackend\` (P0 in §5).


---

## 8. How a fresh session should pick up cold

1. **Read this file in full** (you just did).
2. **Read memory:** `<.claude>/projects/.../memory/MEMORY.md` index, then any of the six entries that look relevant.
3. **Spec read:** §0a "v3.9 amendments" at the top of `.md/grooming-knowledge-software-architecture.md`. Don't read the whole spec unless you need a specific section.
4. **Verify alive:** the cheat-sheet in §6 above.
5. **Check git state:** `git log --oneline -10`. Last meaningful commit (this session): `93a2ce1 Wire Publish button on profile page to op_publish_profile`. If `git status` shows local changes you don't recognise, that's almost certainly OneDrive CRLF noise — `.gitattributes` will normalise.
6. **If user asks about a feature that "should already work":** check §4 "What's done". If it's marked ✅ and the file mentioned exists locally, the feature is live (modulo GitHub Pages cache; hard-refresh).
7. **If user reports a bug:** check §7 "Bugs fixed" first — don't reintroduce. If novel: drive Chrome MCP to reproduce (memory `reference_apps_script_deploy.md` has the techniques), use `mcp__Claude_in_Chrome__javascript_tool` to inspect state, fix, push.
8. **For new work:** respect the design-first feedback (`feedback_design_first.md`) — for non-trivial changes, sketch the approach in chat first (file paths, function names, data flow) and get a thumbs-up from Kamal before writing code. Save Cowork rounds and avoid mid-stream rewrites.
