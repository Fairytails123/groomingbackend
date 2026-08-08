# n8n Workflow Reference

This folder is the source-controlled export and design record for the grooming
n8n workflow. It is **not** automatically the runtime source of truth:
workflows live on `auto.thefairytails.co.uk` (self-hosted n8n on the Hostinger
VPS; migrated off n8n Cloud 2026-07-05). Read back the live workflow before an
edit, validate the final VPS state, then export it to this folder.

The private salon-TV release pipeline does not run through n8n. Apps Script
Version 19 reconciles a hash-only manifest after the sealed TV bundle is
deployed and verified. n8n must never publish the complete book catalogue or
its illustrations to public GitHub. See `../docs/private-tv-publication.md`.

---

## Existing workflow

| ID                | Name                  | n8n URL                                                                |
|-------------------|-----------------------|------------------------------------------------------------------------|
| `6xHWEX3f9zrWtDDa` | Dog Grooming Back End | https://auto.thefairytails.co.uk/workflow/6xHWEX3f9zrWtDDa              |

The production workflow contains the scheduled Apps Script calls and the
Telegram PDF-intake chain. Workflow ID and webhook paths survived the VPS
migration. The three cron callers use the persistent Apps Script Web App URL.
Do not re-run the old placeholder-wiring exercise unless live read-back proves
a node has regressed.

Current division of responsibility:

- n8n: cron triggers, service-token calls, Telegram intake and operational
  orchestration;
- Apps Script: API dispatch, Sheets/Drive state, browser-orchestrated AI
  extraction, session-pack generation and private-release reconciliation;
- private TV host: authenticated breed packs and illustrations.

---

## Constants — paste these everywhere

```
Apps Script Web App URL
  https://script.google.com/macros/s/AKfycby5CU8J-xyCn38ruoe_HdDswRBCNcxXLO9O2AyiiHDt781mwsJzWeyyahySfwjpq4ZL/exec

Telegram group chat ID                 -5072836532
JotForm form ID                        251190647924057
Sheets workbook ID                     1SZtkWUjXXgRIO5CzB_8NBeJ0_SEEq5k3IMAEPBZN01s
Drive root folder ID                   1Ry1YbBVhPwlvb6WFnsxiEBPvBzDDlNUk
GitHub repo                            Fairytails123/groomingbackend
```

Bot token + JotForm API key + GitHub PAT come from `.secrets/` (gitignored).

---

## Pasting the Apps Script URL into the existing workflow

`6xHWEX3f9zrWtDDa` has three HTTP Request nodes that hit Apps Script crons.
Replace the placeholder URL with the constant above. The body shapes are:

| Cron schedule              | Body                                                |
|----------------------------|-----------------------------------------------------|
| 06:00 + 11:30 (daily)      | `{ "op": "rebuild_today_json" }`                   |
| 07:00 (daily)              | `{ "op": "send_tomorrow_prep_alert" }` then `{ "op": "rebuild_tomorrow_json" }` |
| 19:00 (daily)              | `{ "op": "rebuild_tomorrow_json" }`                |

Method: **POST**. Content-Type: **text/plain;charset=utf-8** (not JSON — Apps
Script Web Apps require text/plain to avoid the CORS preflight; the server
side `JSON.parse`s the body). No auth header — these ops are in `PUBLIC_OPS`.

---

## n8n credentials

Create these on `auto.thefairytails.co.uk` (VPS n8n) → Credentials. Each is
shared across multiple workflows. VPS credential IDs differ from the old
cloud ones — workflow JSON references credentials by ID, so re-bind
credentials after importing any export:

| Credential               | Type                 | Used in                        |
|--------------------------|----------------------|--------------------------------|
| Google Sheets — OAuth    | Google Sheets OAuth2 | future direct-write workflows  |
| Google Drive — OAuth     | Google Drive OAuth2  | WF-04 Drive uploads            |
| GitHub Contents API      | HTTP Header Auth     | legacy/session helpers only; never private book content |
| OpenAI                   | OpenAI               | WF-06/07/08 if revived         |
| Telegram Bot             | Telegram             | WF-04, WF-09                   |

For the GitHub HTTP Header Auth credential, set **Name** to `Authorization`
and **Value** to `Bearer <PAT>` where the PAT is the fine-grained token
from `.secrets/` (Contents r/w on `Fairytails123/groomingbackend`).

For the Telegram Bot credential, paste the bot token from
`.secrets/telegram-token.md`.

---

## WF-04: Telegram PDF intake (live)

**Purpose:** Kamal sends a PDF, then the target `PRF-XXX`, to the bot's group
chat. The live 14-node chain holds the pending file in workflow static data,
uploads it through Apps Script and replies with a one-click admin re-extraction
link. The browser remains responsible for the AI extraction sequence.

```text
Telegram Trigger
      |
      v
Allowed-chat gate
      |
      +-- PDF message --> stash file metadata in pendingPdfs[chatId]
      |                  and ask for a separate PRF-XXX message
      |
      +-- text PRF-XXX --> retrieve and clear the matching pending file
                              |
                              v
                         Telegram getFile/download
                              |
                              v
                         build base64 upload payload
                              |
                              v
                         Apps Script op_upload_pdf
                         { service_token, profile_id,
                           pdf_blob_b64, original_filename }
                              |
                              v
                         success/error Telegram reply
                         with admin re-extraction URL using pid=PRF-XXX
```

Do not enqueue or retain a file without its chat/file identity. The pending
static-data record must be cleared on successful handoff and have an operable
error/retry path; inspect the live nodes before changing this state machine.

**Notes on auth:**
- `op_upload_pdf` is not public. Production uses `service_token` in the JSON
  request body, matched against the Apps Script `SERVICE_TOKEN` property.
- Never put the token in this repository or a URL/query string.
- The older short-lived admin-token proposal is superseded.

**Reply timing:** keep the workflow short (< 30s) so Telegram doesn't time
out. The PDF upload to Drive is the slow leg — for large PDFs (>5MB),
consider acknowledging immediately ("Got it, processing...") and sending
the success message after `op_upload_pdf` returns.

---

## WF-09: Telegram heading approval (deferred)

**Purpose:** When a Phase 2 finalize results in `extra_headings_pending > 0`,
fire one Telegram message per pending heading with inline approve / ignore
/ edit buttons. Callbacks update Sheet 6 by calling `op_decide_heading`.

```
[Webhook]                                      (Apps Script POSTs here at finalize time
                                                with body { profile_id, suggested_headings: [...] })
        ↓
[Split In Batches: per heading]
        ↓
[Telegram sendMessage]                         (text: "Approve heading "X" for breed Y?",
                                                inline_keyboard: [
                                                  [{text:"✓ Approve", callback_data:"approve|<approval_id>"}],
                                                  [{text:"✗ Ignore",  callback_data:"ignore|<approval_id>"}],
                                                  [{text:"✎ Edit",    callback_data:"edit|<approval_id>"}],
                                                ])
        ↓
[done — no further action; await callback]

— — — Separate workflow path — — —

[Telegram Trigger: callback_query]
        ↓
[Set: parse callback_data → decision + approval_id]
        ↓
[Switch: decision]
   ↓ approve / ignore                          ↓ edit
[HTTP Request: op_decide_heading]              [Telegram sendMessage with ForceReply:
   { op:"decide_heading",                       "Type the corrected heading. Reply will
     auth_token, approval_id, decision }]       become the new heading."]
   ↓                                                ↓
[Telegram answerCallbackQuery]                  [Telegram Trigger: reply detection]
   (acks the inline-button tap)                     ↓
                                                 [HTTP Request: op_decide_heading
                                                   with decision:"edit_and_approve",
                                                   edited_heading: <reply text> ]
                                                     ↓
                                                 [Telegram sendMessage: "✓ Heading approved."]
```

**Server-side prerequisite:** Apps Script needs to call this webhook on
finalize. Already designed as #29 and #31 — `op_finalize_pdf_intake` returns
`extra_headings_pending`. To wire: add a small post-finalize hook that
POSTs to the WF-09 webhook URL when `extra_headings_pending > 0`. Kamal
sets a Script Property `WF09_WEBHOOK_URL` to enable.

**Schema invariant:** Sheet 6 (Extra Heading Approvals) is shared between
the inline admin-website UI (`op_list_pending_headings` / `op_decide_heading`)
and the Telegram path. `op_decide_heading` is idempotent — once a row is
decided, second decisions throw `CONFLICT`. So if Kamal happens to approve
via both paths, only the first one wins; the second gets a clean error
the workflow can swallow.

---

## How a finalised workflow gets committed back here

```bash
# In n8n, click the workflow → ⋮ menu → Download
# Save as n8n/wf-04-telegram-intake.json (or whatever)
git add n8n/*.json n8n/README.md
git commit -m "n8n: export WF-04 Telegram intake JSON"
git push
```

n8n exports include credential references by ID, not values, so the file
is safe to commit. Anyone restoring the workflow imports the JSON and
re-points to their local credential names.
