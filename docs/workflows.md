# n8n Workflow Reference

Twelve workflows on `ftmanager.app.n8n.cloud`. Each is named `WF-NN-name`. Workflow JSON exports are committed under `n8n/` for source-control and re-imported on the n8n cloud instance.

Distilled from the admin + workflows design agent output (2026-05-03 design pass) and v3.6 spec §4.2.

**Telegram-using workflows are stubbed during build.** Until Kamal provides the bot token at the end of the build, the n8n Telegram credential is empty and the relevant nodes either log to a `Telegram Outbox` sheet or short-circuit to "no-op" — see §"Telegram stubbing" below.

---

## Catalogue

| # | Name | Trigger | Input | Output / side effects | Triggers downstream | Retry |
|---|---|---|---|---|---|---|
| 01 | Daily session sync | Cron 06:00 + 11:30 + JotForm webhook | none / submission payload | `today.json` + per-breed packs to GitHub Pages | none | 3× exponential, alert on final fail |
| 02 | Tomorrow's prep alert | Cron 07:00 | none | Telegram message to Kamal with ✅/⚠️/❌ list | none | 3× |
| 03 | End-of-day pack finalisation | Cron 19:00 | none | Same as #1 but for tomorrow | none | 3× |
| 04 | Telegram PDF intake | Webhook from Telegram bot | `{file_id, breed, groom_type, user_id}` | Drive save, Sheets row (`Processing`), confirm message | #6 ∥ #7 | 3× |
| 05 | Backend PDF intake | Webhook from Apps Script | `{drive_file_id, breed, groom_type}` | Same as #4 (no Telegram confirm) | #6 ∥ #7 | 3× |
| 06 | PDF text extraction + structuring | Webhook (chained from #4/#5) | `{drive_file_id, profile_id}` | `pdftotext` raw → GPT-4o-mini structured JSON → Sheet 3 rows | none (sibling of #7) | 3× — final fail → status=Failed |
| 07 | PDF page rendering | Webhook (chained from #4/#5) | `{drive_file_id, profile_id}` | `pdftoppm` per-page JPEGs → Drive `02-page-renders/` → Sheet 4b rows | #8 | 3× — final fail → status=Failed |
| 08 | AI vision pass (handwritten/blade) | Webhook (chained from #7) | `{profile_id, page_render_ids[]}` | GPT-4o per page → merged into Sheet 3 | #9 | 3× per page (skip on fail, log warning) |
| 09 | Heading approval | Webhook (chained from #8) | `{profile_id, suggested_headings[]}` | Telegram message with inline approve/ignore/edit; flips status to `Needs Review` | none | 3× |
| 10 | Crop generation | Webhook from Apps Script | `{profile_id, page_render_id, role, x, y, w, h}` | Pillow crop on the rendered JPEG → `03-cropped-diagrams/` → Sheet 4 row | none (Apps Script polls) | 3× |
| 11 | Publish | Webhook from Apps Script | `{profile_id}` | Validation, status flip, regenerate breed pack JSON, GitHub Contents API push, refresh `today.json` if booked | #1 (re-fire if booked) | 3×, alert on fail |
| 12 | Backlog signal | Webhook from TV (manual search miss) or from #1 (unmatched booking) | `{raw_breed, source}` | Sheet 9 upsert with hit count | none | 3× silent |

---

## The PDF intake chain (the AI extraction backbone)

```
Telegram /  Backend → WF-04/05 (intake)
                   ↓
                   ├── WF-06 (pdftotext + GPT-4o-mini structuring) ──┐
                   │                                                  │
                   └── WF-07 (pdftoppm renders) → WF-08 (vision pass)─┤
                                                                       ↓
                                                    WF-09 (heading approval)
                                                                       ↓
                                                            status = Needs Review
```

**Why three workflows for extraction, not one:**
- Different failure profiles. `pdftotext` rarely fails on Adobe Scan. `pdftoppm` either succeeds or the PDF is corrupted. Vision is the only one with cost (~$0.05/page) and rate-limit risk. Bundling makes a vision blip kill text + render too.
- Different retry semantics. Vision retries per-page (skip the failed page, keep going); text/render retry whole-document.
- Parallel execution. WF-06 and WF-07 don't depend on each other; running in parallel halves wall-clock time.
- Observability. "Vision pass failed for 3 of last 50 profiles" is actionable; "extraction failed" hides which leg.

---

## AI prompts (used by WF-06 and WF-08)

### WF-06 system prompt

```
You are a grooming-knowledge structurer for a UK dog grooming salon. Your job is to take raw OCR text from a scanned grooming guide and return a structured JSON document.

The output MUST conform exactly to the schema given. Do not add extra fields. Do not include markdown or commentary outside the JSON.

The five core sections, in order, are:
1. "Body"
2. "Throat and chest"
3. "Carriage and tail end"
4. "Legs and feet"
5. "Head/ears/brows"

If a core section has no content in the source, return an empty string for that section's text — do not omit the section.

If you find content that doesn't fit a core section but is clearly a substantive heading (e.g. "Topknot", "Beard care", "Coat texture"), return it under "extra_headings" with a one-sentence reason for inclusion. Do not invent extra headings — only surface ones explicitly present.

Extract every blade number you see (e.g. #7F, #10, 4F, "blade 7"). Normalise to "#7F" style. Do not fabricate.

Extract any safety, breed-specific, or owner-preference notes into "important_notes".

For each piece of extracted content, include a confidence score (0.0-1.0). Below 0.6 means uncertain — surface for human review.
```

### WF-06 schema

```json
{
  "sections": [
    { "name": "Body", "text": "string", "blade_numbers": ["#7F"], "confidence": 0.0 }
  ],
  "extra_headings": [
    { "heading": "Topknot", "text": "string", "reason": "Substantial paragraph at top of page 3.", "confidence": 0.0 }
  ],
  "important_notes": "string",
  "overall_confidence": 0.0
}
```

### WF-08 system prompt

```
You are inspecting a scanned page of a dog grooming guide. The page contains printed body text plus, often, handwritten annotations near small diagrams (e.g. "use #4F here", arrows pointing to specific body parts, breed-specific tweaks scribbled by a senior groomer).

Your job is to return ONLY content that printed-text OCR would have missed. That is:
- Handwritten annotations
- Tiny blade numbers in margins or on diagrams
- Notes hand-drawn near diagrams

Do NOT re-extract printed paragraphs — the OCR has those.
Do NOT describe diagrams visually — only transcribe text/numbers in/near them.
Do NOT invent. If a page has no handwriting and no margin annotations, return an empty list.

For each finding, include:
- "type": "blade" | "handwritten_note" | "annotation"
- "text": the literal transcription
- "position": one of "top", "middle", "bottom", "margin-left", "margin-right", "near-diagram"
- "confidence": 0.0-1.0
```

### WF-08 schema

```json
{ "findings": [
    { "type": "blade", "text": "#4F", "position": "near-diagram", "confidence": 0.8 }
  ] }
```

### Cost estimate

| Component | Per breed | Daily (10) | Monthly |
|---|---|---|---|
| WF-06 GPT-4o-mini | ~$0.001 | $0.01 | $0.20 |
| WF-08 GPT-4o vision (~5 pages × $0.04) | ~$0.20 | $2.00 | $44.00 |
| **Total** | **~$0.20** | **~$2.00** | **~$44.00** |

Round up to ~$60/month with retries and re-runs.

---

## Telegram stubbing during build

Until Kamal provides the bot token at end of build:

1. n8n Telegram credential exists but with token left empty.
2. Each Telegram-using workflow has a flag node `TELEGRAM_LIVE` (env var, default `false`).
3. When `false`: the workflow writes the message + intended buttons to a new `Telegram Outbox` sheet (columns: `id, intended_chat_id, message_text, inline_buttons_json, scheduled_for, status, sent_at`). Status starts `pending`.
4. When `true`: real Telegram node fires. Outbox row's status flips to `sent`.
5. Inbound Telegram (intake of PDFs, callback queries on inline buttons) is end-to-end-untestable until the bot is live. For these, document the API contract clearly and provide a manual-trigger entry point (the backend `/upload.html` page) so the AI extraction chain can still be tested before the bot is live.

This means Stages 2-3 can be built and tested without Kamal having registered a bot. Only Stage 4 (the morning prep loop) requires the live Telegram for end-to-end verification.

---

## Workflow dependency graph

```
JotForm cron (06:00, 11:30, on-submit) ── WF-01 Session sync
JotForm cron 07:00                    ── WF-02 Tomorrow alert ──→ Telegram (stubbed → outbox)
JotForm cron 19:00                    ── WF-03 EOD finalisation
Telegram /msg                          ── WF-04 ─┐
Backend /upload                        ── WF-05 ─┴──→ WF-06 ∥ WF-07 ──→ WF-08 ──→ WF-09 ──→ Telegram (stubbed)
Backend /snip save                     ── WF-10 Crop
Backend /publish                       ── WF-11 Publish ──→ WF-01 (re-trigger if booked)
TV manual-search miss                  ── WF-12 Backlog
WF-01 unmatched booking                ── WF-12 Backlog
```

---

## Things to validate at runtime

- Workflow #1 idempotency on `today.json`. Multiple triggers in quick succession (cron + JotForm webhook within seconds) shouldn't cause overwrites with stale data. Solution: each rebuild reads fresh from Sheets.
- Workflow #11 atomicity. See spec §6.10. Test partial failure of GitHub Contents API by killing the PAT — the sheet status should stay `Draft`, `last_publish_attempt_at` populated, no orphan published JSON.
- Workflow #6 + #7 parallelism. Both should fire from the same parent webhook and rejoin at WF-08.
- Workflow #8 per-page failure tolerance. Inject a deliberate failure on one page and confirm other pages still merge into Sheet 3.
