# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read these first

1. `docs/HANDOVER.md` — operational truth: what is live, what is pending, recent commits, every bug that left a trap. Always read in full before editing.
2. `.md/grooming-knowledge-software-architecture.md` — canonical spec (currently v3.10). The §0a amendment block at the top is the diff against the last full revision; don't read the whole spec unless touching a specific section.
3. `docs/api.md` — Apps Script op catalogue (request/response shapes).
4. `docs/workflows.md` — n8n workflow catalogue. WF-06/07/08 are deprecated for the Phase 2 path (Apps Script owns OpenAI calls directly).

## Big-picture architecture

Three deployment targets glued together by a single Apps Script Web App. There is **no build step** anywhere — admin site, TV site, and Apps Script all run their sources directly.

```
┌─────────────────────┐    POST {op:...}     ┌────────────────────────┐
│ admin/  (vanilla JS │ ───────────────────► │ apps-script/ (.gs)     │
│ ES modules, no      │ ◄─────────────────── │ Web App: doPost        │
│ build, GitHub Pages)│   JSON envelope      │ dispatches via         │
└─────────────────────┘                      │ OP_REGISTRY            │
                                             └─────┬──────────┬───────┘
┌─────────────────────┐                            │          │
│ groomingtv/  (SEP-  │   read-only GETs           ▼          ▼
│ ARATE REPO; TV at   │ ────────────────►   Google Sheets   Google Drive
│ salon)              │   public/*.json     (14 sheets,     (per-breed
└─────────────────────┘                       DB of record)   folders)
                                                    ▲          ▲
┌─────────────────────┐  POST {service_token,...}   │          │
│ n8n cloud (cron +   │ ────────────────────────────┘          │
│ Telegram bot WF-04) │                                        │
└─────────────────────┘   publish flow writes ─────────────────┘
                          public/*.json + breeds/{slug}.json
                          + image commits to GitHub via Contents API
```

Key invariants to keep in mind when editing:

- **Single endpoint, op dispatch.** Every admin/n8n call is `POST <Web App URL>` with body `{op, auth_token|service_token, ...}`. `apps-script/Code.gs` registers handlers in `OP_REGISTRY` and gates non-public ops on `PUBLIC_OPS`. New ops must be added to both.
- **Auth in body, not header.** Apps Script Web Apps strip non-standard headers, and `Content-Type: text/plain` is used deliberately to avoid the CORS preflight (the server JSON-parses the body). Two auth paths: short-lived HMAC `auth_token` from `op_login` (12 h, signed with `SESSION_SECRET`), or static `service_token` matching the `SERVICE_TOKEN` Script Property for n8n.
- **Sheets are the database of record.** Drive holds files (PDFs, page renders, crops); GitHub Pages holds the published artefacts (`public/breeds/{slug}.json`, `today.json`, `tomorrow.json`, `index.json`). Sheets store the canonical state. Atomic publish writes the Sheet row + Drive folder + GitHub commit; concurrency is guarded by `expected_version` on mutating ops.
- **Phase 2 PDF intake is browser-orchestrated.** `admin/js/pdf-intake.js` drives the sequence (upload → render in browser via vendored `pdf.js` → save renders → `extract_sections` → per-page `run_vision_pass_page` → `finalize_pdf_intake`). The Apps Script side is synchronous; there is no job queue.
- **Stable ID prefixes.** `apps-script/ids.gs` defines `BRD`, `PRF`, `SEC`, `IMG`, `PGR`, `APR`, `VER`, `MCH`, `BLG`, `ALT`, `JOB`, `AIC`. Counters live in Script Properties and only increment. Slugs are unique per breed via `uniqueBreedSlug_` (appends `-brd-xxx` on collision).
- **TV display is in a separate repo** (`Fairytails123/groomingtv`, local clone at `C:\Users\FT Manager\OneDrive\Business\CODING\groomingtv\`). It reads `public/*.json` from this repo's GitHub Pages and is intentionally read-only against the back end (the one exception is the public op `log_backlog_hit`).

### Directory map (only the non-obvious bits)

- `admin/js/api.js` — single `api(op, body, opts)` client. `opts.timeoutMs` overrides the 30 s default; AI ops need 60–120 s.
- `admin/js/pdf-intake.js` + `admin/js/pdf.js` — browser-side PDF rendering and orchestrator. Uses vendored `vendor/pdfjs/`.
- `admin/js/pages/*.js` — one module per page; each page's HTML imports it as `<script type="module">`. Page state lives in `store.js`; UI helpers (toasts, dialogs, status pills) in `ui.js`.
- `apps-script/Code.gs` — `doPost` dispatcher + `OP_REGISTRY` + `PUBLIC_OPS`. Start here when adding ops.
- `apps-script/ai.gs` — OpenAI wrapper `callOpenAI_` (branches on `gpt-5|o1|o3` for `max_completion_tokens` + `reasoning_effort`), `op_extract_sections` (gpt-4o-mini text), `op_run_vision_pass_page` (gpt-5 vision), daily cost cap via `assertCostCapNotExceeded_`, `AI Call Log` sheet writes.
- `apps-script/publish.gs` — atomic publish; `writePublicIndex_()` emits `public/index.json` for the TV's autocomplete.
- `apps-script/setup.gs` — `setupAll()` bootstrapper (idempotent: creates Sheets workbook, populates 14 sheet schemas, generates SESSION_SECRET + ADMIN_PASSWORD_SALT, hashes the seeded password and deletes the plaintext property). Re-run after spec/schema bumps.
- `n8n/dog-grooming-backend.json` — exported workflow JSON. Edit on n8n cloud, export, replace the file.

## Common commands

```bash
# Local admin website (static, no build)
npx http-server -p 8080      # then open http://localhost:8080/admin/index.html

# Apps Script — push + deploy when clasp is authed (P2 in HANDOVER §5)
cd apps-script
clasp push
clasp deploy --deploymentId AKfycby5CU8J-xyCn38ruoe_HdDswRBCNcxXLO9O2AyiiHDt781mwsJzWeyyahySfwjpq4ZL
#   ^ persistent deployment id — same Web App URL across all redeploys.
#     Use this rather than `clasp deploy` alone (which mints a new URL).

# If clasp isn't authed (current state on this machine): drive the Apps Script
# editor via Chrome MCP. See memory/reference_apps_script_deploy.md for the
# Monaco setValue / "Manage deployments → edit pencil → New version" path.

# Health-check the live system (5 curls; all should return 200)
curl -s -o /dev/null -w "admin: %{http_code}\n" https://fairytails123.github.io/groomingbackend/admin/login.html
curl -s -o /dev/null -w "tv:    %{http_code}\n" https://fairytails123.github.io/groomingtv/
curl -s -o /dev/null -w "today: %{http_code}\n" https://fairytails123.github.io/groomingbackend/public/today.json
curl -s -o /dev/null -w "index: %{http_code}\n" https://fairytails123.github.io/groomingbackend/public/index.json

# Op smoke test (admin DevTools console) — confirms a new op registered
(await fetch("<WEB_APP_URL>", {
  method:"POST", headers:{"Content-Type":"text/plain"},
  body:'{"op":"<new_op>"}'
})).json()
# Expect {ok:false, error:{code:"UNAUTHORIZED"}} (registered) or
# {ok:false, error:{code:"NOT_FOUND"}} (not registered — push failed)
```

There is no test suite, no linter, and no CI in this repo. Verification is the curl block in `HANDOVER.md §6` plus a manual smoke test in the admin UI.

## Environment hazards specific to this checkout

These are not generic dev advice — they are repeat incidents in this tree. Read `HANDOVER.md §7` for the full list.

- **OneDrive on top of `.git`.** Causes `index.lock` it can't remove from Linux (bug #16 — use PowerShell `Remove-Item -Force .git\index.lock`), object-file dehydration on cold-start (bug #11 — "Always keep on this device" rehydrates), and Edit-tool truncation when rewriting larger files (bug #12). The proper fix is the P0 in HANDOVER §5: move to `C:\dev\groomingbackend\`. Until then: **prefer `sed -i` via Bash over the Edit tool for non-trivial edits to files in this repo**, and run `node --check` / line-count sanity afterwards.
- **CRLF.** `.gitattributes` has `* text=auto eol=lf`. If `git status` shows files you didn't touch, it's almost always CRLF normalisation noise — re-checkout to clear.
- **ES module cache.** After pushing changes to `admin/js/`, the user's Chrome tab won't pick them up via plain hard-refresh. Lead with "DevTools → Application → Clear site data" instead. Incognito serves fresh.
- **OpenAI model quirks** (already handled in `callOpenAI_`, but don't undo them): gpt-5/o1/o3 need `max_completion_tokens` not `max_tokens`, reject custom `temperature`, and share the budget between reasoning + output (set `reasoning_effort: "low"` for vision tasks). `response_format: json_object` requires the literal word "json" somewhere in the messages.
- **Telegram URL gotcha.** Plain-text URLs travelling through Telegram have underscores parsed as italic markup and stripped. Any URL exposed via Telegram must use kebab-case or short keys (e.g. `pid=` not `profile_id=`). `tryReextractFromUrl()` in `admin/js/pages/upload.js` accepts `profile_id`, `profileid`, *and* `pid` defensively.

## Working style on this project

Captured in `<.claude>/projects/.../memory/` and authoritative for *how* to work here:

- **Design before code on non-trivial work.** Sketch file paths, function names, data flow in chat first; get a thumbs-up from Kamal; then write. See `feedback_design_first.md`.
- **Terse responses, no narration.** Short summary after work, not before. See `feedback_terse_responses.md`.
- **Don't ask Kamal to run terminal commands.** When the work needs the Apps Script editor and clasp isn't authed, drive the deploy via Chrome MCP rather than handing him commands. See `feedback_mcp_driven_deploy.md` and `reference_apps_script_deploy.md`.
- **Spec amendments back-fold.** Non-trivial decisions append a numbered entry to `.md/grooming-knowledge-software-architecture.md` §0a. Bump the minor version after ~3 entries.
- **Secrets live in `.secrets/`** (gitignored). Memory holds *pointers* to those files, never the values themselves. See `reference_external_services.md`.
