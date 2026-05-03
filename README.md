# Fairy Tails Grooming Knowledge Software — Backend

Admin website + Apps Script API + n8n workflow exports for the Fairy Tails K9 Centre grooming knowledge system.

**Status:** Stage 2 Week 1 — scaffolding (2026-05-03).

> **New here?** Start with `docs/HANDOVER.md`, then the spec at `.md/grooming-knowledge-software-architecture.md`, then the approved plan at `<.claude>/plans/read-the-md-files-glimmering-glacier.md`.

---

## What this repo contains

```
.md/                  Architecture spec (canonical, v3.6) + previous-version backups
admin/                Admin website — vanilla JS, multi-page, served by GitHub Pages
apps-script/          Apps Script source — deployed via clasp
n8n/                  Exported n8n workflow JSON (re-imported on n8n cloud)
public/               TV-facing JSON + image artefacts (written by WF-11 publish)
vendor/               Cropper.js, Fuse.js — vendored, not CDN
docs/                 Reference docs (HANDOVER, api, workflows, agent designs)
```

---

## Live URLs (after deploy)

- Admin website: `https://fairytails123.github.io/groomingbackend/admin/`
- TV-facing JSON: `https://fairytails123.github.io/groomingbackend/public/today.json`, `/public/breeds/{slug}.json`
- Apps Script Web App: TBD (filled in after first `clasp deploy`)

---

## One-time setup (Kamal does this)

This setup needs Kamal's hands on his Google account, GitHub account, and a terminal. None of these can be automated.

### 1. Google Sheets workbook

Create a new spreadsheet called `Grooming Knowledge Base — DB`. Add 10 sheets matching spec §7:
1. Breeds
2. Groom Profiles
3. Groom Knowledge
4. Images
5. Display Settings
6. Extra Heading Approvals
7. Version History
8. Breed Match Cache
9. Backlog Signals
10. Operational Alerts

Plus auxiliaries: `Page Renders` (sheet 4b), `Jobs` (async work queue), `Telegram Outbox` (build-time stub for Telegram).

Note the spreadsheet ID from the URL: `https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit`.

### 2. Google Drive folder

Create a folder `Grooming Knowledge Base/` at the root of Kamal's Drive. Note the folder ID from the URL: `https://drive.google.com/drive/folders/<DRIVE_ROOT_ID>`.

### 3. GitHub repo + Pages + PAT

1. Create `Fairytails123/groomingbackend` (already done — currently empty).
2. Push this local repo to it once Stage 2 Week 1 scaffolding is committable.
3. Enable GitHub Pages: Settings → Pages → "Deploy from a branch" → `main` branch, `/` (root) folder.
4. Create a fine-grained Personal Access Token:
   - Settings → Developer settings → Personal access tokens → Fine-grained tokens
   - Repo access: only `Fairytails123/groomingbackend`
   - Permissions: Contents (read+write), Metadata (read)
   - Save the token securely.

### 4. Apps Script project + clasp

```bash
# One-time Node tooling install
npm install -g @google/clasp

# Authenticate clasp with Kamal's Google account
clasp login

# In the apps-script/ folder of this repo
cd apps-script
clasp create --type webapp --title "Grooming Backend API" --rootDir .
# This creates .clasp.json — do NOT commit it (it's in .gitignore).

# Push code
clasp push

# Deploy as Web App
clasp deploy --description "Initial deploy"
# Note the Web App URL — needed for admin/js/api.js config.
```

### 5. Apps Script properties + setupAll()

In the Apps Script editor (`clasp open`), open **Project Settings → Script Properties** and add:

| Key | Value |
|---|---|
| `DRIVE_ROOT_ID` | `1Ry1YbBVhPwlvb6WFnsxiEBPvBzDDlNUk` |
| `DEFAULT_PASSWORD` | (the password you want to use — see chat for the agreed value) |
| `GITHUB_PAT` | (fine-grained PAT from step 3) |

Then in the editor, select function `setupAll` and click **Run**. Authorise when prompted. This single function:
- Creates the Sheets workbook in your Drive folder (and stores `SPREADSHEET_ID`).
- Populates all 13 sheets with headers.
- Generates `SESSION_SECRET` and `ADMIN_PASSWORD_SALT` (random, 32 bytes each).
- Reads `DEFAULT_PASSWORD`, hashes + stores it as `ADMIN_PASSWORD_HASH`, and **deletes the `DEFAULT_PASSWORD` property** so the plaintext is gone.
- Sets `GITHUB_OWNER` and `GITHUB_REPO` defaults.

Result: the Apps Script Properties only ever hold the hashed password. Plaintext lives in the editor's Properties UI for the few seconds between paste and Run, then it's deleted.

If you ever want to change the password later, in the editor's function picker run:
```javascript
setAdminPassword('new-password-here')
```
and click Run.

### 6. Admin website config

Edit `admin/js/config.js` (created when this scaffolding is finished) and set `APPS_SCRIPT_URL` to the Web App URL from step 4.

### 7. n8n credentials (later, Stage 3)

In `ftmanager.app.n8n.cloud` create credentials for:
- Google Sheets (OAuth2)
- Google Drive (OAuth2)
- HTTP Header Auth for GitHub (PAT from step 3)
- OpenAI (API key)
- Telegram — **leave token empty until end of build.** Kamal will provide.

### 8. JotForm webhook (later, Stage 2 Week 3)

Add a webhook to the `Grooming Appointment` form (ID `251190647924057`) pointing at the WF-01 webhook URL.

---

## Local development

### Admin website
The admin website is plain static files. Open `admin/index.html` directly in a browser, or run any static server:

```bash
# From the repo root
npx http-server -p 8080
# Then open http://localhost:8080/admin/index.html
```

CORS will block API calls if you serve from `localhost` and the Apps Script URL is `script.google.com`. For local testing during development, deploy the Apps Script Web App with `Who has access: Anyone` and configure CORS in Apps Script's `doPost` to allow `http://localhost:8080`.

### Apps Script
Edit `.gs` files in `apps-script/` and run:
```bash
cd apps-script
clasp push
clasp deploy
```

Each deploy gets a new URL. To keep the same URL across iterations, deploy once and then use `clasp deploy --deploymentId <existing-id>` to redeploy in place.

### n8n workflows
Workflows are exported as JSON under `n8n/`. To edit:
1. Open the workflow on `ftmanager.app.n8n.cloud`.
2. Make changes.
3. Click Settings → Download (export JSON).
4. Replace the file in `n8n/` and commit.

---

## Build progress

See `docs/HANDOVER.md` for live build progress and what's done vs pending. Keep that file updated as you commit.

---

## License

Internal project for Fairy Tails K9 Centre. No public license.
