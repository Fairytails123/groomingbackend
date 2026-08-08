# Private salon-TV publication model

This document explains the publication architecture introduced on 8 August
2026 and deployed with Apps Script Version 19. It is the quickest technical
orientation for a future Claude Code session working on breed publication,
the salon TV, or the grooming-book corpus.

## Current production state

- Protected TV: `https://auto.thefairytails.co.uk/salon-tv/`
- TV repository: `Fairytails123/groomingtv` is private; GitHub Pages is disabled.
- Backend repository: `Fairytails123/groomingbackend` remains public because it
  hosts the password-protected admin shell through GitHub Pages.
- Apps Script: persistent Web App deployment Version 19.
- Registered release: `20260808-knowledge-v2`.
- Live catalogue: 155 breeds, 1,213 approved sections and 271 exact
  illustration crops across 153 breeds.
- Backend profile state: 155 Published, 0 Needs Review, 0 pending TV release,
  0 Drafts.

Manchester Terrier (Standard) and Miniature Bull Terrier have no book image
because their source pages are absent from the supplied scan. No replacement
illustration was fabricated.

## Why the publication model changed

The original design published breed JSON and images into the public
`groomingbackend` repository. That was acceptable for the early test profile,
but it is not an appropriate trust boundary for a complete copyrighted book
corpus and its exact illustrations.

The TV is therefore now a private runtime. Publication has two deliberately
separate stages:

1. Build, verify and deploy the sealed knowledge export to the PIN-protected
   TV host.
2. Register a content-free integrity manifest in the backend so Sheets records
   which exact private release each profile belongs to.

This separation prevents an admin action from accidentally copying book text
or images to public GitHub Pages. It also makes the backend publication state
auditable without making the protected content public.

## End-to-end data flow

```text
Source PDF + reviewed reusable catalogue
                 |
                 v
Deterministic private-TV builder
  - 155 breed packs
  - 271 exact PNG crops
  - manifest + checksums
                 |
                 v
Sealed export verified and deployed to private TV host
                 |
                 v
Hash-only release-registration JSON
                 |
                 v
Admin > Private TV > Register verified release
                 |
                 v
Apps Script validates the complete approved slug/profile/source set
                 |
                 v
One bounded Sheets reconciliation under the script lock
  - Profiles marked Published/private-tv
  - per-profile pack SHA-256 recorded
  - release ledger updated
  - Version History appended
```

The hash-only registration file contains release metadata and SHA-256 values,
not breed text, source pages or images.

## Integrity and safety invariants

- A release must be deployed and independently verified before registration.
- The release source-PDF SHA-256 must match a registered `Reference Sources`
  record.
- Its breed hash map must exactly match the approved reference-catalogue slug
  set; omissions and additions fail closed.
- Linked profiles must exist, be non-archived and have
  `source_type:"reference-catalog"`.
- An intentionally unlinked reference entry is accepted only when its breed is
  already covered by an existing Published profile. Miniature Schnauzer is the
  current known collision.
- A release ID cannot be reused with different manifest/checksum hashes.
- Re-registering the identical release is idempotent: no profile version bump
  and no duplicate `private_tv_publish` history entry.
- The reconciliation holds the Apps Script lock and performs one bounded
  profile-sheet write, avoiding 154 network round trips inside the lock.
- The operation never invokes GitHub file-write helpers.
- Reference-catalogue profiles cannot use `publish_profile` or
  `unpublish_profile`.
- All legacy public publishing fails with `PUBLIC_PUBLISH_DISABLED` unless an
  operator deliberately sets `ALLOW_LEGACY_PUBLIC_PUBLISH=TRUE`. This property
  is an emergency compatibility escape hatch, not the normal workflow.
- Exact illustration masters remain pixel-identical to their PDF-embedded
  sources. Conservative faded-page enhancements are separate derivatives and
  never overwrite or masquerade as the exact master.

## Backend records

`Groom Profiles` adds:

- `publication_target`
- `private_tv_release_id`
- `private_tv_pack_sha256`

`Private TV Releases` is the seventeenth sheet and stores:

- release, manifest, checksum and source-PDF identities;
- aggregate breed/profile/section/image counts;
- the complete per-breed pack hash map;
- protected live base URL;
- registration and last-reconciliation timestamps.

Each changed profile receives one `Version History` record with change type
`private_tv_publish`, actor `private-tv-release`, previous state, new state and
release ID.

## Operations and UI

- `register_private_tv_release` — authenticated write; validates and
  reconciles a hash-only release.
- `private_tv_release_status` — authenticated read; returns the latest release
  summary but not the per-breed hash map.
- `admin/publish.html` — now labelled **Private TV**. It accepts the
  release-registration JSON and makes clear that registration does not upload
  content to GitHub.
- Profile editor publication buttons show `Live on private TV`,
  `Awaiting private TV release`, or `Public publishing disabled`.
- Dashboard `Pending TV release` counts approved reference profiles that are
  not yet reconciled to a private release.

## Reusable private artefacts

These remain under the gitignored knowledge workspace and must not be copied
into the public repository:

- `Knowledge/reusable-data/notes-from-the-grooming-table/private-tv-export/`
- `Knowledge/reusable-data/notes-from-the-grooming-table/private-tv-release-registration.json`
- `Knowledge/reusable-data/notes-from-the-grooming-table/build_private_tv_release_registration.py`

The registration builder reads the already sealed export, verifies its
manifest/checksum relationships and writes a navigation-friendly, hash-only
registration document alongside the export. It must not modify export bytes.

## Current release and verification evidence

Release `20260808-knowledge-v2` reconciled 154 generated reference profiles and
recognised the existing Published Miniature Schnauzer profile as collision
coverage. A second registration was run deliberately and produced no duplicate
history entry.

Production read-back verified:

- admin dashboard: 155 live, all other queues zero;
- library: all 155 breeds show one live profile;
- Afghan Hound: Published, private-TV target, one publication-history record;
- public backend index still contains only the single legacy test breed;
- a public Afghan Hound breed-pack URL returns 404;
- former public TV Pages URL returns 404;
- unauthenticated private JSON and image requests redirect to the PIN page;
- authenticated Portuguese Water Dog guide exposes all 11 body/front/back/head
  references and its `#10`, `#4F`, `#15`, `#40`, `#7F` and `#4` labels.

Regression tests:

```powershell
node tests/reference-library.test.js
node tests/reference-schema.test.js
node tests/publish-approved-images.test.js
node tests/private-tv-publish.test.js
node --check admin/js/pages/publish.js
node --check admin/js/pages/profile.js
git diff --check
```

## Recovery and rollback

- If deployment verification fails, do not register the release. The backend
  stays on its last known release.
- If registration validation fails, correct the builder/export/profile
  mismatch; do not weaken the completeness or hash checks.
- Registration is safe to retry unchanged.
- A TV rollback restores the retained prior private-host release. Backend
  profile state should be reconciled only with a manifest that describes the
  release actually serving users.
- Do not use legacy unpublish for a private-TV profile. Removal requires a new
  verified private release that omits or supersedes the pack, followed by a
  purpose-built backend reconciliation if removal semantics are introduced.

## Files implementing the model

- `apps-script/private-tv-publish.gs`
- `apps-script/publish.gs`
- `apps-script/setup.gs`
- `apps-script/Code.gs`
- `apps-script/dashboard.gs`
- `apps-script/images.gs`
- `admin/publish.html`
- `admin/js/pages/publish.js`
- `admin/js/pages/profile.js`
- `tests/private-tv-publish.test.js`
- `tests/reference-schema.test.js`

## Remaining physical-device check

Desktop Chrome and live HTTP checks pass. The outstanding display-specific
task is a walkthrough on the salon's actual Hisense Vidaa browser, including
PIN entry by remote, D-pad search, dense multi-angle thumbnail navigation and
refresh/reload recovery.
