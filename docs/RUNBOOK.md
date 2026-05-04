# RUNBOOK — Kamal-side wiring

Step-by-step list of what Kamal needs to do that Claude couldn't do
autonomously. Each step has a copy-pasteable command or a clickable URL
and an "expected result" so you can verify as you go.

Order is roughly low-effort → higher-effort. Aim is ~30 minutes total
for everything below.

---

## 0. Commit the day's work to git

Once everything else in this runbook has been verified, run this in
PowerShell from the repo root:

```powershell
cd "C:\Users\FT Manager\OneDrive\Business\CODING\Grooming Software"

# Sanity check: should show the modified files plus a few new ones.
git status

# Stage everything we want to commit.
git add `
  apps-script/Code.gs `
  apps-script/dashboard.gs `
  apps-script/setup.gs `
  admin/dashboard.html `
  admin/js/pages/dashboard.js `
  admin/js/pdf-intake.js `
  .md/grooming-knowledge-software-architecture.md `
  .md/grooming-knowledge-software-architecture.v3.8.backup.md `
  docs/HANDOVER.md `
  docs/api.md `
  docs/RUNBOOK.md `
  n8n/README.md

# Commit with a thorough message.
git commit -m "Stage 3 follow-on: re-extract page-count fix, dashboard polish, runbook" -m "Built in the same session that smoke-tested Phase 2:

* admin/js/pdf-intake.js — re-extract now catches up on missing page renders.
  Diff existing renders against locally rendered pages; save the missing ones.
  Closes the gap where re-extracting a profile whose stored renders were a
  strict subset of the source PDF would silently skip the back pages.

* op_acknowledge_alert (apps-script/dashboard.gs + Code.gs OP_REGISTRY) —
  patches Operational Alerts row with acknowledged_at + acknowledged_by.
  Idempotent. Dashboard renders a Dismiss button per alert (admin/js/pages/
  dashboard.js). Deployed as Apps Script v9.

* op_health_check (apps-script/dashboard.gs + Code.gs PUBLIC_OPS) — returns
  Property-set booleans (never the values), sheet counts, last AI call,
  today's GBP AI spend. Surfaces in dashboard's new Backend health card.
  Deployed as Apps Script v10.

* setupTriggers() (apps-script/setup.gs) — programmatic install of the
  midnight resetLoginFailCounter trigger. Idempotent. Replaces the manual
  Triggers-UI click-through. setupAll() calls it; standalone setupTriggers()
  available for re-runs.

* Spec bumped v3.8 → v3.9 with five new amendments (#34-#38) covering the
  three vision-call fixes, the re-extract page-count fix, and op_acknowledge_alert.
  v3.8 backup at .md/*.v3.8.backup.md.

* docs/api.md gains a Dashboard ops section documenting acknowledge_alert
  + health_check.

* n8n/README.md — design + build instructions for WF-04 Telegram intake
  and WF-09 Telegram heading approval, including all hard-coded constants
  (Apps Script URL, chat ID, etc.). JSON exports get committed back to
  n8n/ once Kamal finalises them in the n8n UI.

* docs/RUNBOOK.md — this file. Operational steps Kamal performs to finish
  wiring the system."

# Push.
git push
```

**Expected:** `pushed to origin/main`. The admin website on
`https://fairytails123.github.io/groomingbackend/admin/` will pick up the
new dashboard panels within a minute or two as GitHub Pages rebuilds.

---

## 1. Generate `GITHUB_PAT` and paste into Apps Script Properties (~3 min)

The publish-to-GitHub-Pages flow currently fails with `GITHUB_FAILED`
because the personal-access-token is missing. After this step, the
"publish profile" button on the admin website starts working.

1. Open https://github.com/settings/personal-access-tokens — sign in if
   needed.
2. Click **Generate new token** (top right) → **Fine-grained tokens**.
3. **Token name:** `groomingbackend (publish)`.
4. **Expiration:** pick something practical — 1 year is fine, longer if
   you don't want to rotate. Set a calendar reminder.
5. **Repository access:** "Only select repositories" →
   `Fairytails123/groomingbackend`.
6. **Permissions → Repository permissions:**
   - **Contents:** read and write
   - **Metadata:** read-only (auto-required)
7. Click **Generate token**. Copy the token (`github_pat_…`).
8. Open the Apps Script project:
   https://script.google.com/home/projects/1sxgzOrmd2OEmuJmMeoW15Vbb1GkbO1GIhs3h0afmOafcgOb1tDErvIA1/edit
9. ⚙ Project Settings (left-side gear icon) → **Script properties** → **Add
   script property**.
10. **Property:** `GITHUB_PAT` — **Value:** paste the token. Click **Save**.

**Verify:** open
https://fairytails123.github.io/groomingbackend/admin/dashboard.html — the
Backend health card should now show `0 required Properties not set ✓`. (If
the card still says missing, hard-refresh the page.)

---

## 2. Run `setupTriggers()` once in the Apps Script editor (~30 sec)

Installs the midnight reset trigger for the login-fail counter so brute-force
attempts don't accumulate forever.

1. With the Apps Script editor still open from step 1, click on
   `setup.gs` in the file tree.
2. In the function dropdown at the top (just to the right of "Debug"),
   select **`setupTriggers`**.
3. Click **▶ Run**.
4. First run: an authorisation prompt opens — click through it (allow
   `Google Apps Script` to manage triggers in your account).
5. Second click of **▶ Run** if it didn't actually run after auth.

**Verify:** click the clock icon in the left rail (Triggers). You should
see one trigger:
```
resetLoginFailCounter — Time-driven — Day timer — Midnight to 1am
```

---

## 3. Paste the Apps Script URL into n8n's existing workflow (~3 min)

The "Dog Grooming Back End" workflow at
https://ftmanager.app.n8n.cloud/workflow/6xHWEX3f9zrWtDDa has three HTTP
Request nodes that hit Apps Script crons. Their URL field is currently a
placeholder.

1. Open the workflow.
2. Find the three HTTP Request nodes (one per cron schedule: 06:00 + 11:30,
   07:00, 19:00).
3. For each: replace the URL with:
   ```
   https://script.google.com/macros/s/AKfycby5CU8J-xyCn38ruoe_HdDswRBCNcxXLO9O2AyiiHDt781mwsJzWeyyahySfwjpq4ZL/exec
   ```
   - Method: **POST**
   - Body Content Type: **Raw / Text**
   - Body matches the cron — see `n8n/README.md` "Pasting the Apps Script URL
     into the existing workflow" for the exact JSON per cron.
4. Save the workflow. Click **Inactive → Active** in the top-right toggle
   when ready.

**Verify:** click **Execute Workflow** on the cron node manually. You
should see a 200 response from Apps Script and a Telegram-Outbox row in
the Sheets workbook.

---

## 4. Wire n8n credentials (~10 min — one-time)

Create on `ftmanager.app.n8n.cloud` → Credentials. Each credential is
shared across all workflows that need that connection.

| Credential name             | Type                | What it's for                                  |
|------------------------------|---------------------|-----------------------------------------------|
| `Google Sheets — workbook`   | Google Sheets OAuth2 | future direct-write workflows (none today)    |
| `Google Drive — root`        | Google Drive OAuth2  | WF-04 Drive uploads (when built)              |
| `GitHub Contents API`        | HTTP Header Auth    | name `Authorization`, value `Bearer <PAT>` from step 1 |
| `OpenAI`                     | OpenAI               | only if WF-06/07/08 are revived (currently the live path is direct from Apps Script) |
| `Telegram Bot — fairy tails` | Telegram             | bot token from `.secrets/telegram-token.md` (when WF-04/09 are built) |

For each Google credential, n8n walks you through an OAuth flow — click
**Connect**, allow the scopes, you're done.

**Verify:** in any workflow node that uses one of these credentials, the
green tick appears next to "Credential to connect with".

---

## 5. JotForm webhook → n8n WF-01 trigger (~3 min)

Today, `today.json` rebuilds at 06:00 + 11:30 from the cron. After this
step, it also rebuilds within seconds of any new JotForm submission, so
last-minute bookings appear on the TV without waiting for the next cron.

1. Open https://www.jotform.com/myforms — sign in.
2. Find form **Grooming Appointment** (form ID `251190647924057`).
3. Click **Settings** (top tab) → **Integrations** (left rail) → search
   for **Webhooks**.
4. Add a webhook URL:
   ```
   https://ftmanager.app.n8n.cloud/webhook/<your-WF-01-webhook-path>
   ```
   (Get the exact path by opening WF-01 in n8n and copying the webhook
   node's production URL.)
5. **Save**.

**Verify:** make a test JotForm submission with a real breed. Within a
few seconds, the n8n workflow should fire (visible in n8n's Executions
tab) and `today.json` on GitHub Pages should include the new booking.

---

## 6. (Recommended) Move repo out of OneDrive (~10 min)

Today's session hit three OneDrive-induced incidents:
1. `.git/objects/*` files dehydrated to Files-On-Demand placeholders;
   git reported "corrupt object".
2. CRLF/LF flips across 9 files (mitigated by `.gitattributes`).
3. The `Edit` tool's writes raced with OneDrive sync, truncating
   `apps-script/ai.gs` mid-function on two separate edits.

git + GitHub already gives you authoritative version control + off-machine
backup. OneDrive on top is redundant and dangerous. The clean fix:

```powershell
# 1. Make sure all work is committed and pushed (step 0 above).
git -C "C:\Users\FT Manager\OneDrive\Business\CODING\Grooming Software" status
# Should report "nothing to commit, working tree clean".

# 2. Pause OneDrive (right-click cloud icon in tray → Pause syncing → 8 hours)
#    so it doesn't fight with the move.

# 3. Move the folder.
Move-Item `
  "C:\Users\FT Manager\OneDrive\Business\CODING\Grooming Software" `
  "C:\Users\FT Manager\Code\Grooming Software"

# 4. Verify the new location.
git -C "C:\Users\FT Manager\Code\Grooming Software" log --oneline -3
git -C "C:\Users\FT Manager\Code\Grooming Software" remote -v

# 5. Re-point Cowork: in this chat, click the folder picker in the
#    bottom-right and select the new path. Cowork will re-mount it.

# 6. Resume OneDrive sync. Ignore any "missing folder" warnings — git is
#    your version control now, not OneDrive.
```

If anything feels off, the original folder is still in OneDrive's recycle
bin for 30 days as a safety net.

---

## 7. (Optional) `clasp login` for cleaner Apps Script deploys (~2 min)

Today's deploys (v6 through v10) went via Chrome MCP + Monaco's exposed
`setValue` API. That works but is brittle. Setting up `clasp` properly
makes future deploys a one-liner.

```powershell
# In any PowerShell window:
clasp login

# Authorise the Google account in the browser. Returns "Authorized" once done.

# Verify .clasp.json has the right project ID.
cd "C:\Users\FT Manager\Code\Grooming Software\apps-script"  # or current path
cat .clasp.json
# Should contain "scriptId": "1sxgzOrmd2OEmuJmMeoW15Vbb1GkbO1GIhs3h0afmOafcgOb1tDErvIA1"
# If file missing, copy .clasp.json.example and fill in the ID.

# Future deploys:
clasp push
clasp deploy --deploymentId AKfycby5CU8J-xyCn38ruoe_HdDswRBCNcxXLO9O2AyiiHDt781mwsJzWeyyahySfwjpq4ZL --description "vN <description>"
```

---

## 8. (Reserved) Build WF-04 Telegram intake when Telegram is ready

See `n8n/README.md` for the full design. ~30-45 min once credentials are
wired. Adds Telegram as a second PDF intake path (browser stays the
primary).

## 9. (Reserved) Build WF-09 Telegram heading approval

See `n8n/README.md`. ~20-30 min. Only useful if/when AI starts surfacing
extra headings (none surfaced for the Miniature Schnauzer test PDF).

---

## Sanity check at the end

After steps 0-5, hit
https://fairytails123.github.io/groomingbackend/admin/dashboard.html and
look at the Backend health card. You should see:

- "All required Script Properties are set ✓"
- Sheet counts non-zero
- Last AI call recent and `success` (matching whatever Kamal's done last)
- Today's AI spend reflecting actual usage

If any of those are off, the relevant step above has a Verify clause —
work back from there.
