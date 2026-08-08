# Production runbook — grooming knowledge and private salon TV

Current baseline: 8 August 2026, Apps Script Version 19, private release
`20260808-knowledge-v2`.

This replaces the original build-day wiring checklist. The Google, GitHub,
n8n and TV services are already configured. Do not repeat first-time setup or
reactivate retired workflow paths.

## 1. Normal health check

Expected HTTP boundary:

```powershell
curl.exe -s -o NUL -w "admin: %{http_code}\n" https://fairytails123.github.io/groomingbackend/admin/login.html
curl.exe -s -o NUL -w "tv PIN: %{http_code}\n" https://auto.thefairytails.co.uk/salon-tv/
curl.exe -s -o NUL -w "old TV: %{http_code}\n" https://fairytails123.github.io/groomingtv/
curl.exe -s -o NUL -w "public Afghan pack: %{http_code}\n" https://fairytails123.github.io/groomingbackend/public/breeds/afghan-hound.json
```

Expected: admin 200, TV PIN 200, old TV 404, public Afghan pack 404.

Unauthenticated requests to private-TV JSON or image paths must return a 303
redirect to `/salon-tv/`. A 200 response containing protected JSON/image bytes
is a security incident.

After admin login, the dashboard baseline is:

- Live cards: 155
- Need review: 0
- Pending TV release: 0
- Drafts: 0

Admin → Private TV must show release `20260808-knowledge-v2`, 155 breeds,
1,213 sections and 271 images.

## 2. Regression checks before any release

Run from the repository root:

```powershell
node tests/reference-library.test.js
node tests/reference-schema.test.js
node tests/publish-approved-images.test.js
node tests/private-tv-publish.test.js
node --check admin/js/pages/publish.js
node --check admin/js/pages/profile.js
git diff --check
```

All commands must pass. `private-tv-publish.test.js` specifically proves that
the private release path contains no GitHub content-write helpers, that the new
operations require authentication, and that legacy public publishing fails
closed.

## 3. Apps Script deployment

Use the persistent deployment ID only:

```powershell
Set-Location apps-script
clasp push
clasp deploy --deploymentId AKfycby5CU8J-xyCn38ruoe_HdDswRBCNcxXLO9O2AyiiHDt781mwsJzWeyyahySfwjpq4ZL --description "vN concise-description"
clasp deployments
```

The final line must show the persistent deployment at the intended version.
Never run a bare `clasp deploy`; that creates a different Web App URL and can
strand the admin and n8n callers.

After a schema change, run the authenticated operation or documented setup
path that calls `ensureSheets_()`. `setupAll()` is idempotent but should not be
used casually in production. The current workbook has 17 sheets.

Dispatcher smoke test for an authenticated-only operation:

```javascript
(await fetch("<WEB_APP_URL>", {
  method: "POST",
  headers: { "Content-Type": "text/plain" },
  body: '{"op":"private_tv_release_status"}'
})).json()
```

Expected without a token: `UNAUTHORIZED`. `NOT_FOUND` means the deployment did
not receive the operation.

## 4. Build and deploy a new private TV release

Only do this after the reusable catalogue is final, approved and integrity
clean.

1. Work from
   `Knowledge/reusable-data/notes-from-the-grooming-table/`.
2. Build the sealed private-TV export with the existing deterministic builder.
3. Run the export verifier. It must validate every manifest/checksum entry,
   breed pack and image. Source-gap breeds must remain explicit.
4. Confirm exact image masters still match their recorded encoded and decoded
   pixel hashes. Enhanced variants must remain separate.
5. Deploy the sealed export to the isolated private TV container using the TV
   repository's deployment procedure.
6. Verify the protected host independently: PIN page, authenticated index,
   representative breeds, all image hashes and unauthenticated redirects.
7. Retain the prior server release and configuration as rollback material.
8. Only after steps 1–7 pass, generate the hash-only registration file with:
   `build_private_tv_release_registration.py`.

The registration file belongs alongside the sealed export, never inside it;
placing it inside changes the export manifest and must make verification fail.

## 5. Reconcile backend publication state

1. Sign in to the admin site.
2. Open **Private TV**.
3. Confirm the page describes the already-deployed protected release and does
   not offer public GitHub publishing.
4. Choose the hash-only `private-tv-release-registration.json`.
5. Check the release ID and breed count in the confirmation.
6. Select **Register verified release**.
7. Wait for reconciliation; the operation has a 120-second client timeout.

Expected result:

- release summary updates;
- profiles transition to Published as required;
- pending table becomes empty;
- dashboard and sidebar counts refresh;
- each changed profile receives one `private_tv_publish` history entry.

Retry the same registration once when validating a new implementation. The
second run must report no transitions and must not add history rows.

Do not register a manifest before the matching bundle is serving users. Backend
state is evidence of a deployed release, not a deployment trigger.

## 6. Post-release verification

Verify using final persisted and served values:

- Admin dashboard totals match the release.
- Admin library shows every expected breed live.
- A representative profile reports `publication_target:"private-tv"`, the
  current release ID and exactly one history entry for that transition.
- TV search returns the expected breed count.
- A dense guide such as Portuguese Water Dog exposes every illustration angle,
  not only the first six.
- Blade labels and grooming boundaries remain readable and unchanged.
- Public backend index has not gained the private catalogue.
- A representative public breed-pack path returns 404.
- Former TV GitHub Pages remains 404.
- Unauthenticated private data and image requests redirect to the PIN page.
- n8n remains healthy; private release registration does not edit n8n.

Record counts, status codes, deployment version, commit IDs and any untested
scenario in `docs/HANDOVER.md`.

## 7. Failure and recovery

### Builder or integrity verification fails

Stop. Keep the current live release and backend state. Correct the source,
mapping or builder defect and regenerate. Never suppress a hash, missing-page,
blade-label or grooming-boundary failure.

### Private deployment fails

Restore the retained previous TV release. Do not register the failed release.
Recheck PIN, authenticated packs and image hashes after rollback.

### Registration validation fails

The operation is fail-closed and should not partially transition profiles.
Compare the approved reference slug set, profile links, source PDF identity and
release hash map. Fix the mismatch at its source; do not weaken validation.

### Registration times out

Read the backend release status and representative profile history before
retrying. The operation is idempotent, so an unchanged retry safely resolves a
response lost after a successful write.

### Public catalogue content appears

Treat it as a privacy incident. Do not enable the escape hatch. Identify the
commit or caller, remove public content through a reviewed remediation, verify
Pages/CDN behaviour and record the incident. Preserve audit evidence.

### TV pack must be removed or superseded

Build and deploy a corrected private release first. Do not call legacy
`unpublish_profile` for a private-TV profile. The current backend intentionally
blocks that path.

## 8. n8n boundary

All n8n work targets `https://auto.thefairytails.co.uk`. Never reactivate the
retired cloud instance. The private-TV release pipeline does not run through
n8n; Apps Script owns release registration, while the VPS workflow continues
scheduled session-pack and Telegram intake duties.

Before changing the workflow, read back the live VPS version, compare it with
`n8n/dog-grooming-backend.json`, make the smallest change, validate it, then
export the live result back into this repository.

## 9. Git and documentation handoff

This repository is public and daily cron jobs can create new commits. Before a
push:

```powershell
git fetch origin main
git rev-list --left-right --count origin/main...main
git status --short
```

Rebase only when the worktree and rollback implications are understood. Stage
only intended tracked files; preserve untracked backups and user files.

Every handoff must state:

- exact commits and deployments;
- changed files and why;
- final backend/TV counts;
- integrity and regression checks;
- public/private boundary results;
- untested physical-device scenarios;
- rollback position and known risks.

## 10. Remaining physical TV walkthrough

On the salon's Hisense Vidaa device, verify PIN entry using the remote, D-pad
search, opening a breed, changing sections, selecting all dense thumbnails,
locking, refreshing and recovering after a browser restart. This remains the
only major display-specific check not reproduced by desktop Chrome.
