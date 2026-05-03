# Fairy Tails Grooming Knowledge Software — Architecture & Build Plan

**Owner:** Kamal (Fairy Tails K9 Centre)
**Status:** Working spec, v3.4 (web-hosted, no-install model made explicit)
**Last updated:** 3 May 2026

---

## 1. One-paragraph summary

Two connected pieces of software that together support a permanent **daily knowledge-building loop**. Every morning, the system looks at tomorrow's JotForm bookings, identifies any breeds not yet in the published knowledge base, and pushes a Telegram alert listing them. Kamal then has the full working day to upload breed-specific PDFs via Telegram, the system extracts content using AI, Kamal reviews and publishes through the backend website, and those breeds are live on the salon TV before opening the next morning. This loop runs forever — over the first 6-8 months it builds the core breed library; afterwards it absorbs whatever new or unusual breeds walk through the door. The TV display is a read-only PWA that pulls today's grooms from JotForm, shows large breed buttons for the booked dogs, and renders the approved grooming guide with images preserved exactly as they appear in the source PDFs.

---

## 2. Confirmed decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | **Booking source: JotForm** (form ID `251190647924057`) | Already part of the stack |
| 2 | **Single editor: Kamal only** | Simple password gate on backend website |
| 3 | **TV display is open** (no login) | Groomers walk up and use it |
| 4 | **Multi-dog bookings = multiple JotForm submissions** | One dog per submission; each dog gets its own breed button automatically |
| 5 | **TV shows Full Groom appointments only** | Bath & Brush, Teeth & Nails filtered out |
| 6 | **Breed field is free text** | Fuzzy matcher + learning cache required |
| 7 | **JotForm submission = confirmed booking** | "Confirm Appointment" is the submit action; no separate status |
| 8 | **Image extraction is mechanical, classification is AI** | PyMuPDF preserves bytes exactly; ChatGPT vision labels roles; backend allows one-click override |
| 9 | **PDFs are uploaded breed-by-breed** | No big-book ingestion; Kamal controls what enters |
| 10 | **TV is a PWA with offline cache** | Wifi drops = cached content keeps showing |
| 11 | **Hosting: GitHub Pages** under `fairytails123` for static sites; Apps Script for Sheets API |
| 12 | **Saturdays as a config flag** | System works any day; flag flipped when Saturday opening starts |
| 13 | **Master sheet "Jot form Dog Details" is read-only** | Never written to by automation |
| 14 | **Knowledge base grows continuously via daily booking-driven loop** | Tomorrow's bookings drive today's digitisation; ~5-10 breeds per day target; 6-8 month horizon for core library; system supports new breeds forever |
| 15 | **Missed-day tolerance — patient, ever-learning system** | If Kamal doesn't upload a PDF for a breed, or a booking is for a later day, that day is simply skipped. The breed will come back around in another booking. No chase alerts, no scramble logic. The TV's manual search and parent-breed fallback handle unprepped breeds gracefully. |
| 16 | **Groom type is decided on the floor, not at booking** | JotForm does not capture groom type. The TV defaults to Pet Groom for every breed; if a breed has multiple published groom types (Show, Sporting, Puppy, etc.), the working screen shows a remote-navigable toggle in the top bar to switch. |
| 17 | **TV UI must be remote-friendly throughout** | D-pad navigation, OK to select, large focusable buttons, clearly visible focus rings, no mouse-dependent interactions. Applies whether the TV runs the page directly or via an HDMI kiosk device. |
| 18 | **Web-hosted, no installation anywhere** | Both frontend (TV display) and backend (admin website) are HTML/JS apps hosted on GitHub Pages. Access is by URL via any modern browser. Nothing is installed on the TV, on phones, or on any device. This makes the system device-agnostic and reversible — if the Vidaa browser ever proves unreliable, plug in a Pi/Fire Stick at the same URL and nothing changes in the code. |

---

## 3. Operational model — the daily knowledge-building loop

This is the heart of how the system actually runs day-to-day, not just at launch.

```
MORNING (07:00, just after today's session sync)
  n8n pulls tomorrow's JotForm Full Groom bookings
       ↓
  For each unique breed: check knowledge base
       ↓
  Telegram alert to Kamal:
       ✅ Already published
       ⚠️ Draft only, needs publish
       ❌ Not in system, needs digitising
       ↓
DURING THE DAY (Kamal, fitted around other work)
  For each ❌ breed Kamal chooses to handle:
    Upload PDF via Telegram
    System extracts text + images via AI
    Kamal reviews/tweaks in backend website
    Click Publish
       ↓
  For each ⚠️ breed Kamal chooses to handle:
    Open in backend, review draft, click Publish
       ↓
  Anything not handled is simply skipped — no chase, no penalty.
  Those breeds will resurface in a future morning alert when booked again.
       ↓
END OF DAY (19:00)
  Final regen of tomorrow's session pack from whatever has been published
  Tomorrow's TV is as ready as it is
       ↓
NEXT MORNING (06:00)
  n8n regenerates today's session pack
  TV display loads today's breeds
  Groomers see breed guides for any prepped breeds
  Unprepped breeds fall back to manual search / parent-breed suggestions
```

**Key properties of this loop:**
- **The booking calendar is the prioritisation engine.** No need for a separate "which breeds should we digitise next?" decision — the customers tell us via their bookings.
- **A full working day to prep.** Morning alert means Kamal has the entire day to fit digitising around other work, rather than scrambling overnight.
- **Patient and ever-learning.** Missed days are fine. If Kamal doesn't get to a breed, the system doesn't chase. That breed will resurface in a future morning alert when it's booked again. The backlog (Sheet 9) accumulates hit counts so frequently-unprepped breeds float to the top naturally.
- **The system is permanent, not a project that ends.** Even after 200 breeds are digitised, the daily loop keeps running and absorbs new breeds, cross-breeds, unusual coats.
- **Graceful degradation when a breed isn't ready.** The TV's manual search suggests parent breed alternatives (Cavapoochon → Cavapoo / Cavachon / Cockapoo), and the breed is logged to the backlog. No alarm, no panic — just a calm fallback.
- **Telegram is the primary control surface.** Kamal can drive the whole loop from his phone — uploads, approvals, image role overrides — without sitting at a desk.

---

## 4. System components

### 4.1 JotForm — booking source

- **Form ID:** `251190647924057` ("Grooming Appointment")
- Single dog per submission
- **Five conditional appointment date/time fields** depending on "Type of Appointment":
  - Full Groom or Hand Strip — with bus pick-up/drop-off ✅ **show on TV**
  - Full Groom or Hand Strip — parent drop-off/pick-up ✅ **show on TV**
  - Bath and Brush — with bus ❌ ignore
  - Bath and Brush — parent drop-off/pick-up ❌ ignore
  - Teeth and Nails ❌ ignore
- n8n normalises the five conditional date fields into one `appointment_datetime` per submission

### 4.2 n8n — orchestration

Lives at `ftmanager.app.n8n.cloud`. Workflows:

1. **Daily session sync** (06:00, 11:30, on demand) — pulls today's confirmed Full Groom appointments, writes `today.json` to GitHub Pages
2. **Tomorrow's grooms morning prep** (07:00) — pulls tomorrow's bookings, cross-references the knowledge base, pushes Telegram alert with ✅/⚠️/❌ status per breed. One alert per day. Missed = missed.
3. **End-of-day pack finalisation** (19:00) — final regen of tomorrow's session pack from whatever has been published that day
4. **Telegram PDF intake** — receives PDF, asks for breed/groom type via inline buttons, saves to Drive, queues extraction
5. **Backend PDF intake** — same as Telegram, triggered by webhook from the backend upload form
6. **PDF text extraction** — sends extracted text to ChatGPT, structures into core sections + blade numbers, suggests extra headings
7. **PDF image extraction** — mechanical extraction with PyMuPDF; ChatGPT vision classifies roles; saves originals to Drive
8. **Heading approval** — Telegram inline buttons (Approve / Ignore / Edit), updates Sheets
9. **Publish** — runs validation, flips status to Published, regenerates breed pack on GitHub Pages
10. **Backlog signal** — when TV's manual search hits an unmatched breed, n8n logs it as "needs digitising" with hit count, so frequently-unprepped breeds rise in priority naturally

### 4.3 Google Sheets — structured database

Nine sheets (full schema in §7). The TV display does **not** read Sheets directly — it reads pre-baked JSON files instead.

### 4.4 Google Drive — file store

```
Grooming Knowledge Base/
└── {Breed Name}/
    └── {Groom Type}/
        ├── 01-original-pdf/
        ├── 02-extracted-images/   (originals — never overwritten)
        ├── 03-display-images/     (compressed for TV; preserves all annotations)
        ├── 04-ai-output/          (raw JSON from ChatGPT)
        ├── 05-approved-output/    (final published JSON)
        └── 06-version-history/
```

### 4.5 Backend website — knowledge-building tool

GitHub Pages site under `fairytails123`, password-gated. Vanilla JS + Apps Script API.

This is **the tool Kamal uses every day**, not a one-off configuration screen. Designed for daily use. Screens:

- **Dashboard** — counts of Published / Draft / Needs Review / Failed; **tomorrow's prep status** at the top (the same ✅/⚠️/❌ list Telegram sent); recent uploads; unmatched breeds backlog
- **Breed library** — search and manage; filter by status, breed type, groom type
- **Breed profile editor** — edit AI output, blade numbers, sections, images
- **Image layout editor** — assign image roles, drag to reorder, override AI classification, choose largest, preview TV layout
- **Groom type manager** — add, rename, duplicate, archive groom types per breed
- **Manual upload form** — alternative to Telegram route
- **Publish control** — Draft → Published with validation

**Draft / Published pair:** Editing a Published profile creates/updates a Draft. The TV continues showing the last Published version until you re-publish.

### 4.6 TV display — web page accessed by URL

GitHub Pages site under `fairytails123`. Nothing is installed anywhere — the Hisense TV's built-in Vidaa browser simply navigates to the URL (e.g. `https://fairytails123.github.io/grooming-display`) and the page loads.

**Offline cache (best-effort):** A service worker caches today's session pack and breed packs. On wifi loss the TV continues to show whatever was last cached, with a quiet "offline — cached at 09:14" indicator. Service worker reliability depends on browser support; modern Chromium-based browsers handle this perfectly, but the Vidaa browser's behaviour will need verification in practice. If offline reliability matters more than cost, swap in a Raspberry Pi or Fire TV Stick at the same URL — no code changes needed.

**Start screen:** Today's grooms shown as large breed buttons. Each booking = one button. Default view is rolling 4-hour window with AM / PM / All today toggle.

**Working screen:**
- Top bar: session toggle, breed buttons from the day, **groom type toggle** (only shown if breed has 2+ published groom types — see §6.8), refresh, last-updated time
- Main area: configurable image/text split (default 75/25, per-profile override)
- Image area: 1 main image (largest) + N supplementary stacked vertically
- Text area: blade numbers at top, then sections, then warnings/notes

**Remote-friendly UI rules (apply throughout):**
- All interactive elements navigable by TV remote D-pad (up/down/left/right)
- OK button on remote selects/activates
- Visible focus ring on the currently-highlighted element (high-contrast outline)
- Large hit targets (minimum 80px height for buttons)
- No hover-only interactions, no drag-and-drop, no right-click menus
- Sensible focus order (left-to-right, top-to-bottom)
- Back button returns to previous screen

**Manual search:** For breeds not in today's bookings, or unmatched. Suggests similar profiles (parent breeds for cross-breeds). Logs unmatched searches as backlog signals.

### 4.7 Telegram — primary control surface

Used for:
- **Tomorrow's grooms morning prep alert** at 07:00 — drives the daily knowledge-building loop. One alert per day. If it gets missed, it gets missed.
- Uploading PDFs on the go
- Inline-button approvals (heading suggestions, image role overrides, breed match resolution)
- Daily morning summary at 06:00 ("Today: 3 grooms — Cavapoo, Schnauzer, Cockapoo. All matched ✅")

Inline buttons throughout — no free-text parsing.

---

## 5. Data flows

### 5.1 The daily knowledge-building loop

See §3 above. This is the operational backbone.

### 5.2 Today's TV cycle

```
06:00  n8n pulls today's JotForm submissions
       Filter to Full Groom appointment types only
       Normalise the five conditional date fields to one appointment_datetime
       Run each breed through fuzzy matcher → matched_breed_id
       Assemble breed packs for matched breeds
       Log unmatched breeds (already alerted last night, but log anyway)
       Write today.json + per-breed packs to GitHub Pages
       Push Telegram morning summary

11:30  Re-run (catches same-day bookings)

On TV load:
       Service worker fetches today.json
       Caches all breed packs for booked breeds
       Renders breed buttons
```

### 5.3 PDF upload cycle (the build mechanism)

```
Telegram or backend → PDF received
       ↓
       Save original PDF to Drive
       Create Sheets row, status = Processing
       ↓
       PyMuPDF extracts text + images mechanically (preserves bytes)
       ↓
       ChatGPT extracts written sections, blade numbers, suggests extra headings
       ChatGPT vision classifies image roles
       ↓
       Telegram message with inline buttons: heading approval
       ↓
       Status = Needs Review
       ↓
       Backend editor: Kamal reviews, corrects, overrides, edits
       ↓
       Click Publish → validation checks → status = Published
       ↓
       Regenerate breed pack on GitHub Pages
       ↓
       If breed appears in today/tomorrow's bookings: refresh session pack
```

---

## 6. Key design decisions explained

### 6.1 Tomorrow's grooms prep loop is a first-class feature

This isn't a "nice to have" — it's the mechanism by which the knowledge base grows. Without it, Kamal has no signal for which breed to digitise next, and the system reverts to a "build the whole thing first" model that defeats the purpose. Every architectural decision should support this loop running smoothly every evening.

### 6.2 Fuzzy breed matcher with learning cache

Free-text breed input means we cannot rely on exact matches. A `Breed Match Cache` sheet stores every match decision and gets smarter over time:

| raw_breed | matched_breed_id | matched_breed_name | confidence | source | first_seen |
|---|---|---|---|---|---|
| Cavapoo puppy | BRD-001 | Cavapoo | 0.95 | fuzzy | 2026-05-01 |
| Cavoodle | BRD-001 | Cavapoo | 1.00 | manual | 2026-04-28 |
| Mini Schnauzer | BRD-002 | Miniature Schnauzer | 1.00 | manual | 2026-04-15 |

**Logic:**
1. Check cache for exact `raw_breed` match → use it
2. If no match: token-based fuzzy match against breed names + alternative_names
3. If confidence ≥ 0.85: auto-match, log as fuzzy
4. If confidence < 0.85: flag as unmatched, push Telegram alert with suggested matches and inline-button resolution
5. Every manual resolution is written back to cache

### 6.3 Mechanical image extraction + AI classification

- **Extraction = code.** PyMuPDF/`pdfimages` pulls bytes byte-identical to what's embedded
- **Classification = AI.** ChatGPT vision labels which image is main / front / back / head
- **Override = human.** Backend editor lets Kamal one-click reassign roles

Keeps the "images preserved exactly" rule absolute, while using AI where it's actually better.

### 6.4 1 main + N supplementary (not fixed 4)

Slot-based assignment: 1 main image + 0-N supplementary, ordered by Kamal in the backend. TV adapts.

### 6.5 Pre-baked JSON files (not live Sheets queries)

TV reads `today.json` from GitHub Pages, not directly from Sheets. Instant load, no API quotas, service worker can cache for offline. n8n regenerates files on every change.

### 6.6 Cross-breeds = own profile + parent links

Cross-breeds get their own profile, but the breed record stores `parent_breeds` for fallback. Manual search on a not-yet-digitised cross-breed suggests the parents.

### 6.7 Soft AM/PM with rolling window

Hard 12:00 reset has edge cases (11:45 booking disappearing). Default: rolling 4-hour window with AM / PM / All today toggle.

### 6.8 Groom type loading: Pet Groom default + remote toggle

When a groomer selects a breed on the TV, the system applies this logic to choose which groom profile to load:

1. **Look for a Published profile with `groom_type = "Pet Groom"`** for this breed → load it
2. **If no Pet Groom exists**, load the profile marked `default_profile = TRUE` for this breed
3. **If neither exists**, load the only Published profile (most breeds will only have one)
4. **If multiple non-Pet groom types exist with no default flag**, load the first by `groom_type` alphabetically and surface this as a backend warning

**The toggle UI:** Only renders when the breed has 2+ Published groom types. Buttons sit in the top bar. The currently-loaded type is highlighted. D-pad to navigate, OK to switch. Switching reloads the working screen with the new profile's text and images.

**Editorial rule:** Every breed should have a Pet Groom profile as its baseline. Show / Sporting / Puppy / Maintenance variants are always additions, never replacements. This guarantees the default always works.

---

## 7. Google Sheets schema

All sheets sit in a new workbook (NOT the existing read-only "Jot form Dog Details" master sheet).

### Sheet 1: Breeds
`breed_id, breed_name, breed_type (pure/cross), parent_breeds, alternative_names, common_jotform_names, notes, status, created_date, last_updated`

### Sheet 2: Groom Profiles
`profile_id, breed_id, breed_name, groom_type, source_type, source_pdf_drive_id, default_profile, status (Draft/Published/Archived), current_version, approved_date, published_date`

### Sheet 3: Groom Knowledge
`profile_id, section_name, section_order, section_text, blade_numbers, important_notes, ai_confidence, approved`

Core sections: Body, Throat and chest, Carriage and tail end, Legs and feet, Head/ears/brows + approved extras.

### Sheet 4: Images
`profile_id, image_id, image_role (main/front/back/head/extra), drive_file_id, original_filename, display_position, is_main, ai_classified_role, human_overridden, approved`

### Sheet 5: Display Settings
`profile_id, image_panel_width (%), text_panel_width (%), main_image_id, supplementary_order, font_size, show_blade_box, show_warnings, theme`

### Sheet 6: Extra Heading Approvals
`profile_id, suggested_heading, ai_reason, telegram_message_id, user_decision, final_status, date`

### Sheet 7: Version History
`version_id, profile_id, change_type, previous_value, new_value, date, reason`

### Sheet 8: Breed Match Cache (learning matcher)
`raw_breed, matched_breed_id, matched_breed_name, confidence, source (manual/fuzzy), first_seen, last_seen, hit_count`

### Sheet 9: Backlog Signals
`raw_breed, first_seen, last_seen, search_count, current_status (open/digitising/done), priority, source (booking/manual_search)`

---

## 8. Build sequence — restructured

The previous sequence put AI extraction late and treated it as polish. That's wrong, because **AI extraction + Telegram + the backend editor together ARE the daily knowledge-building loop**. The system isn't operational until they exist. So the order is restructured:

### Stage 1 — TV display proof of concept (target: 2 days)

**Definition of done:** A 40-inch TV in the salon shows one breed (Cavapoo Pet Groom) at a single URL. Hand-typed text, hand-uploaded images. Validates the display layout works for groomers in practice.

**Why first:** Cheapest possible test of the whole concept. If groomers don't engage with the TV display in the first week, the project needs rethinking before any automation is built.

### Stage 2 — Backend editor + JotForm session pack (target: 2 weeks)

**Definition of done:**
- Backend website with breed library, profile editor, image layout editor, publish control
- 5+ breeds entered manually through the editor
- TV pulls today's grooms from JotForm via n8n daily session sync
- Manual fuzzy match cache (Kamal types resolutions; no AI matching yet)

**Why second:** Now Kamal has a proper editor and the TV reflects real bookings. Knowledge is still entered manually but the operational shell of the system exists.

### Stage 3 — Telegram + AI extraction (target: 2 weeks) — **Knowledge factory online**

**Definition of done:**
- Send a PDF to Telegram → system extracts text + images
- ChatGPT structures the content into core sections + blade numbers
- ChatGPT vision classifies image roles
- Drafts appear in the backend for Kamal to review and publish
- Heading approvals via Telegram inline buttons

**Why third:** This is the milestone where the daily 5-10 breed velocity becomes possible. From here the breed library grows continuously.

### Stage 4 — Tomorrow's grooms prep loop (target: 1 week) — **Loop closed**

**Definition of done:**
- 07:00 Telegram morning alert with ✅/⚠️/❌ status per breed for tomorrow
- 19:00 end-of-day pack finalisation
- Backend dashboard shows tomorrow's prep status at the top
- TV's parent-breed fallback works for any unprepped breed encountered the next day

**Why fourth:** Closes the operational loop. From this point on, the system tells Kamal what to digitise next, every morning, automatically. Missed days are accepted as part of the rhythm — the TV's fallback handles unprepped breeds and the backlog naturally surfaces frequently-needed breeds over time.

### Stage 5 — Fuzzy matching, PWA polish, offline cache, version history (target: 2 weeks)

**Definition of done:**
- Token-based fuzzy matcher with confidence scoring (manual cache becomes auto-matched)
- PWA service worker caches today's session for offline use
- Version history recording all edits
- Backlog visualisation on dashboard

**Total:** ~7 weeks calendar time. After Stage 4 (~5 weeks in), the daily knowledge-building loop is fully operational and the breed library starts growing naturally with bookings.

---

## 9. Open questions / decisions still needed

1. **Hand Strip vs Full Groom split.** JotForm bundles them as one appointment type. The TV will show both by default; the breed guide content will indicate hand-strip suitability (terriers, schnauzers, wires).
2. **Bath and Brush appointments — final call.** Currently filtered out. Worth showing breed-aware bath/coat-handling instructions for these too?
3. **Confirmed: web-hosted, accessed by URL.** The Hisense Vidaa browser opens the GitHub Pages URL directly. No installation. No kiosk hardware required at launch. Architecture is device-agnostic — if Vidaa proves unreliable in practice, swap in a Raspberry Pi or Fire TV Stick at the same URL with zero code changes.
4. **Confirmed: groom type is NOT captured at booking.** Decided on the floor via remote-navigable toggle on the TV, with Pet Groom as the always-on default. See §6.8.
5. **Brand styling.** Confirm brand colours (#00B4D8 / #0077B6 / #023E8A) for both backend and TV, or keep TV in a high-contrast functional palette for salon-floor readability?
6. **Backend website domain.** New repo (`fairytails123/grooming-knowledge`) or sub-route of existing ft-ops site?
7. **Confirmed: prep timings are 07:00 (morning alert) and 19:00 (final regen).** One alert per day. Missed days accepted.
8. **Confirmed: same-day rescue not needed.** TV's manual search and parent-breed fallback handle any unprepped breed encountered on the day.

---

## 10. Scope

**In scope:**
- Backend editor (single user, used daily)
- TV display (read-only PWA)
- JotForm-driven daily session pack
- Tomorrow's grooms prep alert (the operational loop)
- Telegram + backend PDF upload routes
- AI text extraction + image classification
- Cross-breed handling
- Offline cache
- Version history
- Backlog signal for unmatched breeds
- Continuous knowledge growth (system never "finishes")

**Explicitly out of scope:**
- Multi-user editing
- Customer-facing views
- Big-book ingestion of the 172MB "Notes from the Grooming Table" PDF (use breed-by-breed PDFs instead)
- Direct writes to the master "Jot form Dog Details" sheet
- Replacing JotForm with a custom booking system
- Inventory, scheduling, payment processing (handled elsewhere)
