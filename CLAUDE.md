# CLAUDE.md

<!-- n8n-vps-brief:v2 -->
## ⚠️ n8n platform: self-hosted VPS — NOT n8n Cloud (since 2026-07-04)

The business's n8n has moved from n8n Cloud (`ftmanager.app.n8n.cloud`) to a **self-hosted n8n on a Hostinger VPS**. All work in this project assumes n8n lives on the VPS.

- **n8n editor / API / webhook base: `https://auto.thefairytails.co.uk`** (webhooks: `https://auto.thefairytails.co.uk/webhook/<path>`; workflow IDs and webhook paths were preserved from cloud).
- **Cutover status: MIGRATION COMPLETE (2026-07-05) — all 32 production workflows are live on the VPS; n8n Cloud is fully inactive (0 of 47 active)** and its subscription is pending cancellation (Phase F5). Every external caller is repointed and every Telegram bot verified.
- **Never reactivate anything on the cloud instance** — a cloud Telegram-trigger activation steals the bot webhook back from the VPS instantly, and schedule triggers double-fire. If a bot flip is ever redone: unpublish cloud FIRST, then activate on VPS (cloud deactivation deletes the bot webhook and can clobber a fresh VPS registration).
- **All work targets the VPS.** Build, change, and amend workflows — and any code that calls n8n — against `auto.thefairytails.co.uk`. The cloud copies are retired snapshots; never edit, import to, or activate them.
- **n8n MCP deploys:** before creating/updating workflows via an n8n MCP, verify the MCP targets the VPS instance. If it still points at n8n Cloud, ask Kam to reconnect it to `https://auto.thefairytails.co.uk` first.

**Source of truth for the migration** (VPS specs, SSH access details, credential + data-table ID maps, cutover record, live status): `C:/Users/Kam/OneDrive/Business/CODING/Hostinger_n8n/n8n-vps-migration-handover.md` — a private OneDrive folder outside this repo. **This repo is public (GitHub Pages)** — server access details (IPs, SSH targets, key names, server paths) stay in that private doc and must never be written into files here.

**Self-hosting benefits — design for them:**
- No cloud plan limits: no execution-time caps and no per-execution/active-workflow billing pressure — long-running, heavy, or chatty workflows are fine; split logic into as many workflows as is clean.
- Full server control: root SSH and the `docker exec` n8n CLI (bulk import/export, upserts by workflow ID), container logs, compose + env — connection details and paths are in the private handover doc above.
- Community nodes can be installed if a task needs them (cloud didn't allow this).
- Static egress IP usable for third-party API allowlists (value in the private handover doc).

**Caveats:**
- Credential IDs and data-table IDs are DIFFERENT on the VPS vs cloud (maps: `C:/Users/Kam/OneDrive/Business/CODING/Hostinger_n8n/cloud-export-2026-07-04/cred-id-map-batch*.json`). Data Table nodes reference tables BY ID — never copy cloud IDs into VPS workflows.
- Any caller (web page, script, form, bot, dashboard) found still pointing at `ftmanager.app.n8n.cloud` is a bug — repoint it to `https://auto.thefairytails.co.uk` immediately, and never write anything new against the cloud URL.

### n8n cloud references in this repo (repointed 2026-07-11)

All live docs were repointed to the VPS on 2026-07-11: `docs/workflows.md`, `docs/RUNBOOK.md` (steps 3–5), `docs/HANDOVER.md` (key links + WF-04 notes), `README.md`, `n8n/README.md`, the canonical spec (§4.2 + §0a amendment #46), and the gitignored `.secrets/telegram-token.md`. Any remaining `ftmanager.app.n8n.cloud` matches in this checkout are historical copies only — dated spec/HANDOVER backups and untracked duplicate checkouts under `.claude/worktrees/` — and are intentionally left as-is. If a *live* doc or code path mentions the cloud URL (or generic "n8n cloud" as the current platform), treat it as a bug: repoint it immediately and re-grep `ftmanager.app.n8n.cloud` to confirm nothing else regressed.

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read these first

1. `docs/HANDOVER.md` — operational truth: what is live, what is pending, recent commits, every bug that left a trap. Always read in full before editing.
2. `.md/grooming-knowledge-software-architecture.md` — canonical spec (currently v3.12). The §0a amendment block at the top is the diff against the last full revision; decisions #47–49 define the reviewed corpus, private TV and backend publication model.
3. `docs/api.md` — Apps Script op catalogue (request/response shapes).
4. `docs/private-tv-publication.md` — current publication trust boundary, integrity invariants, recovery and implementation map.
5. `docs/workflows.md` — current n8n boundary plus the explicitly historical twelve-workflow design. WF-06/07/08 are deprecated for the Phase 2 path (Apps Script owns OpenAI calls directly).

## Current release baseline — do not infer from historical sections

- Apps Script persistent deployment: Version 19.
- Protected TV: `https://auto.thefairytails.co.uk/salon-tv/`.
- Registered release: `20260808-knowledge-v2`.
- Backend: 155 Published, 0 Needs Review, 0 pending TV release, 0 Drafts.
- Private release: 155 breed packs, 1,213 sections, 271 exact crops.
- Workbook: 17 sheets, including `Reference Sources`, `Reference Entries` and
  `Private TV Releases`.
- Commit `176a812` introduced the control plane. The older v18 import section
  in the handover is historical evidence, not the present queue state.

## Big-picture architecture

Four boundaries cooperate through a single Apps Script Web App. The admin has
no build step. The protected TV is packaged separately from a deterministic,
gitignored knowledge export.

```
GitHub Pages admin ──POST ops──► Apps Script v19
                                      │
                                      ├──► Google Sheets (17-sheet DB)
                                      ├──► Google Drive (private source data)
                                      └◄── n8n VPS (cron + Telegram intake)

Reviewed reusable corpus ──► deterministic private-TV export
                                      │
                                      ├──► PIN-hosted isolated TV container
                                      └──► hash-only registration manifest
                                                   │
                                                   └──► Apps Script reconciliation
```

Key invariants to keep in mind when editing:

- **Single endpoint, op dispatch.** Every admin/n8n call is `POST <Web App URL>` with body `{op, auth_token|service_token, ...}`. `apps-script/Code.gs` registers handlers in `OP_REGISTRY` and gates non-public ops on `PUBLIC_OPS`. New ops must be added to both.
- **Auth in body, not header.** Apps Script Web Apps strip non-standard headers, and `Content-Type: text/plain` is used deliberately to avoid the CORS preflight (the server JSON-parses the body). Two auth paths: short-lived HMAC `auth_token` from `op_login` (12 h, signed with `SESSION_SECRET`), or static `service_token` matching the `SERVICE_TOKEN` Script Property for n8n.
- **Sheets are the backend database of record.** Drive holds private PDFs,
  renders, crops and reference records. GitHub Pages hosts the admin and legacy
  session artefacts only. The complete breed catalogue and book illustrations
  live in the sealed private-TV export.
- **Private publication is evidence reconciliation, not content upload.** The
  verified bundle is deployed first. `register_private_tv_release` then checks
  the approved slug set, source identity, profile coverage and pack hashes
  before one bounded Sheets write marks profiles Published.
- **Legacy publication fails closed.** Reference profiles never enter
  `publish_profile`; all legacy GitHub content publishing requires the explicit
  emergency property `ALLOW_LEGACY_PUBLIC_PUBLISH=TRUE`.
- **Release retries are idempotent.** An identical release does not bump
  profile versions or duplicate history. A reused release ID with different
  hashes returns `CONFLICT`.
- **Phase 2 PDF intake is browser-orchestrated.** `admin/js/pdf-intake.js` drives the sequence (upload → render in browser via vendored `pdf.js` → save renders → `extract_sections` → per-page `run_vision_pass_page` → `finalize_pdf_intake`). The Apps Script side is synchronous; there is no job queue.
- **Stable ID prefixes.** `apps-script/ids.gs` defines `BRD`, `PRF`, `SEC`, `IMG`, `PGR`, `APR`, `VER`, `MCH`, `BLG`, `ALT`, `JOB`, `AIC`. Counters live in Script Properties and only increment. Slugs are unique per breed via `uniqueBreedSlug_` (appends `-brd-xxx` on collision).
- **TV display is in a separate private repo** (`Fairytails123/groomingtv`,
  local clone at `C:\Users\FT Manager\OneDrive\Business\CODING\groomingtv\`).
  GitHub Pages is disabled. The PIN host serves same-origin protected breed
  packs and illustrations; only authenticated today/tomorrow requests refresh
  from the legacy public session-pack source.

### Directory map (only the non-obvious bits)

- `admin/js/api.js` — single `api(op, body, opts)` client. `opts.timeoutMs` overrides the 30 s default; AI ops need 60–120 s.
- `admin/js/pdf-intake.js` + `admin/js/pdf.js` — browser-side PDF rendering and orchestrator. Uses vendored `vendor/pdfjs/`.
- `admin/js/pages/*.js` — one module per page; each page's HTML imports it as `<script type="module">`. Page state lives in `store.js`; UI helpers (toasts, dialogs, status pills) in `ui.js`.
- `apps-script/Code.gs` — `doPost` dispatcher + `OP_REGISTRY` + `PUBLIC_OPS`. Start here when adding ops.
- `apps-script/ai.gs` — OpenAI wrapper `callOpenAI_` (branches on `gpt-5|o1|o3` for `max_completion_tokens` + `reasoning_effort`), `op_extract_sections` (gpt-4o-mini text), `op_run_vision_pass_page` (gpt-5 vision), daily cost cap via `assertCostCapNotExceeded_`, `AI Call Log` sheet writes.
- `apps-script/private-tv-publish.gs` — validates and reconciles a verified,
  hash-only private release. It must never call GitHub content-write helpers.
- `apps-script/publish.gs` — retired/legacy public publisher. It is retained for
  compatibility but disabled by default and is not the private-TV path.
- `apps-script/setup.gs` — `setupAll()` bootstrapper (idempotent: creates the
  workbook, populates 17 sheet schemas, generates crypto properties and hashes
  the staged password). Do not run casually against production.
- `admin/publish.html` + `admin/js/pages/publish.js` — Private TV release
  registration UI; accepts the hash-only JSON after deployment verification.
- `n8n/dog-grooming-backend.json` — exported workflow JSON. Edit on the VPS n8n (`auto.thefairytails.co.uk`), export, replace the file.

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

# If clasp authentication later expires, use the documented Apps Script editor
# fallback rather than minting a new deployment URL.

# Health-check the live system: admin/TV/session files 200; old TV 404
curl -s -o /dev/null -w "admin: %{http_code}\n" https://fairytails123.github.io/groomingbackend/admin/login.html
curl -s -o /dev/null -w "tv PIN: %{http_code}\n" https://auto.thefairytails.co.uk/salon-tv/
curl -s -o /dev/null -w "old TV: %{http_code}\n" https://fairytails123.github.io/groomingtv/
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

There is no CI, but there is a targeted Node regression suite. Run the four
tests listed in `README.md` and `docs/RUNBOOK.md`, syntax-check changed modules,
then verify final persisted admin state plus the protected/public HTTP boundary.

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
