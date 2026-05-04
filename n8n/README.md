# n8n Workflow Reference

This folder is the source of truth for n8n workflow design. It is **not** the
runtime — workflows live on `ftmanager.app.n8n.cloud`. Use this README to
build / repair / version-control workflows; export the JSON from n8n into
this folder once a workflow is finalised, and commit alongside other
backend changes.

---

## Existing workflow

| ID                | Name                  | n8n URL                                                                |
|-------------------|-----------------------|------------------------------------------------------------------------|
| `6xHWEX3f9zrWtDDa` | Dog Grooming Back End | https://ftmanager.app.n8n.cloud/workflow/6xHWEX3f9zrWtDDa              |

Populated as Phase 1 with sticky-noted architecture and four entry points
(cron 06:00 + 11:30, cron 07:00, cron 19:00, Telegram intake stub, crop
generation stub). Apps Script URL placeholders need filling in (see
"Pasting the Apps Script URL" below).

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

Create these on `ftmanager.app.n8n.cloud` → Credentials. Each is shared
across multiple workflows:

| Credential               | Type                 | Used in                        |
|--------------------------|----------------------|--------------------------------|
| Google Sheets — OAuth    | Google Sheets OAuth2 | future direct-write workflows  |
| Google Drive — OAuth     | Google Drive OAuth2  | WF-04 Drive uploads            |
| GitHub Contents API      | HTTP Header Auth     | future publish helpers (n8n side) |
| OpenAI                   | OpenAI               | WF-06/07/08 if revived         |
| Telegram Bot             | Telegram             | WF-04, WF-09                   |

For the GitHub HTTP Header Auth credential, set **Name** to `Authorization`
and **Value** to `Bearer <PAT>` where the PAT is the fine-grained token
from `.secrets/` (Contents r/w on `Fairytails123/groomingbackend`).

For the Telegram Bot credential, paste the bot token from
`.secrets/telegram-token.md`.

---

## WF-04: Telegram PDF intake (deferred)

**Purpose:** Kamal sends a PDF to the bot's group chat with a caption
containing a breed name. The workflow uploads the PDF to Drive via Apps
Script, sets the profile to `Processing`, and replies with a one-click
link to start AI extraction in the admin browser.

```
[Telegram Trigger]                            (on message, document type)
        ↓
[IF: chat.id == -5072836532 AND               (security gate; ignore other chats)
     document.mime_type == application/pdf]
        ↓
[Set: parse breed_name from caption]          (e.g. caption "Cavapoo" → breed_name: "Cavapoo")
        ↓
[Telegram: getFile]                           (resolves file_id → file_path on Telegram CDN)
        ↓
[HTTP Request: download PDF]                  (returns binary; convert to base64 in next node)
        ↓
[Function: build payload]                     (base64 the binary, package the search query)
        ↓
[HTTP Request: search_breeds]                 (POST → APPS_SCRIPT_URL with body
                                               { op:"search_breeds", auth_token:"<<service token>>",
                                                 query: breed_name, limit:1 })
        ↓
[IF: matches[0] exists]
   ↓ true                                              ↓ false
[HTTP Request: list_breeds → first profile_id]   [Telegram sendMessage:
                                                  "Breed not in library yet. Add via admin first."]
   ↓
[HTTP Request: op_upload_pdf]                 (POST → APPS_SCRIPT_URL with body
                                               { op:"upload_pdf", auth_token,
                                                 profile_id, pdf_blob_b64, original_filename })
   ↓
[Telegram sendMessage]                        (reply: "✓ PDF received for {breed}.
                                                Run AI extraction:
                                                https://fairytails123.github.io/groomingbackend/admin/profile.html
                                                ?profile_id={profile_id}")
```

**Notes on auth:**
- `op_upload_pdf` is NOT in `PUBLIC_OPS`, so the workflow needs an `auth_token`.
- Easiest: create a service-account login by running `op_login` once with
  the admin password and storing the returned token in n8n credentials as
  a generic credential. Token TTL is 12h, so this needs renewal — better
  to add a `service_token` Script Property and tighten `requireAuth_()` to
  accept it as a static service token (one-line change to `auth.gs`).
- Until that's done, easiest dev path: run a fresh login in browser
  DevTools, copy `localStorage["ft.session_token"]`, paste into a Set node.
  Refresh roughly daily.

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
