# Fairy Tails Grooming Knowledge Software — Backend

Production admin, Apps Script API and operational documentation for the Fairy
Tails dog-grooming knowledge system.

## Current state

- Admin: `https://fairytails123.github.io/groomingbackend/admin/`
- Protected salon TV: `https://auto.thefairytails.co.uk/salon-tv/`
- Apps Script: persistent Web App deployment Version 19
- Private release: `20260808-knowledge-v2`
- Catalogue: 155 Published breeds, 1,213 sections and 271 exact illustration
  crops; no review, pending-release or draft backlog
- n8n: self-hosted VPS at `https://auto.thefairytails.co.uk`; the former n8n
  Cloud instance is retired and must never be reactivated

The complete grooming-book catalogue is not published to GitHub Pages. The TV
repository is private, its former Pages site is disabled, and its JSON/images
are served only after the server-side PIN gate. This public backend repository
hosts the admin shell and legacy session JSON only.

## Read first

1. `docs/HANDOVER.md` — live operational truth and recent release evidence.
2. `docs/private-tv-publication.md` — why publication changed, invariants,
   recovery and file map.
3. `.md/grooming-knowledge-software-architecture.md` — canonical v3.12 spec;
   §0a decisions #47–49 define the corpus, private TV and release control plane.
4. `docs/api.md` — Apps Script request/response contracts.
5. `docs/RUNBOOK.md` — current verification, release and rollback procedure.
6. `docs/workflows.md` and `n8n/README.md` — live n8n boundary and historical
   workflow catalogue.

## Architecture

```text
GitHub Pages admin
       |
       | POST { op, auth_token | service_token, ... }
       v
Apps Script Web App v19
       |---------------------> Google Sheets (17-sheet database of record)
       |---------------------> Google Drive (private PDFs/renders/reference data)
       |
       +<--------------------- n8n VPS schedules + Telegram intake

Reviewed reusable catalogue
       |
       v
Deterministic private-TV export -> verified PIN-hosted TV container
       |
       v
Hash-only release registration -> Apps Script -> profile publication ledger
```

Publication is a two-stage trust boundary. The private bundle must be built,
verified and deployed first. The backend then registers only its hashes and
reconciles profile status. The registration operation never sends book text or
images to GitHub.

## Repository map

```text
.md/          Canonical architecture and dated backups
admin/        Static password-gated admin UI; no build step
apps-script/  Apps Script API and Sheets/Drive logic
docs/         Handover, runbook, API and workflow references
n8n/          Export of the live VPS grooming workflow
public/       Legacy/session JSON only; not the private book catalogue
tests/        Node regression tests for reference and publication invariants
vendor/       Vendored browser libraries
Knowledge/    Gitignored reusable source corpus and private release artefacts
```

The TV application is a separate private repository at the sibling local path
`C:\Users\FT Manager\OneDrive\Business\CODING\groomingtv\`.

## Critical invariants

- Sheets are the backend database of record; Drive holds private source files.
- `register_private_tv_release` accepts hashes only and requires authentication.
- Release slugs must exactly equal the approved reference catalogue.
- Reference profiles cannot enter the legacy public publisher.
- Legacy public publishing is disabled unless the emergency property
  `ALLOW_LEGACY_PUBLIC_PUBLISH=TRUE` is deliberately set.
- Exact illustrations are pixel-verified source crops. Enhanced faded-page
  derivatives remain separate and never replace the exact master.
- Missing source pages remain explicit gaps; never fabricate an illustration,
  blade number, label or grooming boundary.
- New Apps Script deployments must reuse the persistent deployment ID so the
  Web App URL does not change.
- All n8n work targets `auto.thefairytails.co.uk`, never the retired cloud
  instance.
- This repository is public. Never commit credentials, customer data, private
  server access information, source-book content or private release bundles.

## Local checks

The admin has no build step. Serve the repository root with any static server
when local browser testing is needed.

```powershell
node tests/reference-library.test.js
node tests/reference-schema.test.js
node tests/publish-approved-images.test.js
node tests/private-tv-publish.test.js
node --check admin/js/pages/publish.js
node --check admin/js/pages/profile.js
git diff --check
```

Apps Script deployment:

```powershell
Set-Location apps-script
clasp push
clasp deploy --deploymentId AKfycby5CU8J-xyCn38ruoe_HdDswRBCNcxXLO9O2AyiiHDt781mwsJzWeyyahySfwjpq4ZL --description "vN concise-description"
clasp deployments
```

Do not use `clasp deploy` without the deployment ID: it creates a new URL.

## Publication workflow

1. Finalise and approve the reusable catalogue.
2. Build and verify the sealed private-TV export.
3. Deploy the verified bundle to the private TV host.
4. Generate the hash-only release-registration JSON.
5. In Admin → Private TV, upload and register that JSON.
6. Verify release totals, dashboard totals, one profile history, the private
   authentication boundary and the public 404 boundary.

See `docs/RUNBOOK.md` for exact expected results and rollback guidance.

## Known remaining check

The release has passed desktop and live HTTP verification. The remaining
display-specific test is a full walkthrough on the salon's Hisense Vidaa TV
using its remote control.

## Licence and confidentiality

Internal software for Fairy Tails K9 Centre. No public licence. Public source
code does not grant rights to the private grooming-book corpus or illustrations.
