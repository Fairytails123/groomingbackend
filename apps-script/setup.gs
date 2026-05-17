/**
 * setup.gs — one-shot bootstrapper.
 *
 * Run setupAll() once from the Apps Script editor after deploying. It:
 *   - generates SESSION_SECRET and ADMIN_PASSWORD_SALT (idempotent)
 *   - creates the Sheets workbook in the Drive root folder if it doesn't exist
 *   - populates all 13 sheets with headers
 *   - sets GITHUB_OWNER and GITHUB_REPO defaults
 *
 * What still needs hand work after setupAll():
 *   - setAdminPassword('your-password-here')   — Kamal picks this
 *   - GITHUB_PAT script property                 — Kamal pastes a fine-grained PAT
 *   - APPS_SCRIPT_URL in admin/js/config.js     — Kamal pastes after first deploy
 */

const DEFAULTS = {
  GITHUB_OWNER: "Fairytails123",
  GITHUB_REPO: "groomingbackend",
  WORKBOOK_NAME: "Grooming Knowledge Base — DB",
};

/** Headers per sheet. Adding columns later is safe (ensureSheet_ adds them). */
const SHEET_SCHEMAS = {
  "Breeds": [
    "breed_id", "breed_name", "slug", "breed_type", "parent_breeds",
    "alternative_names", "common_jotform_names", "notes", "status",
    "created_date", "last_updated"
  ],
  "Groom Profiles": [
    "profile_id", "breed_id", "breed_name", "groom_type", "source_type",
    "source_pdf_drive_id", "default_profile", "status", "error_message",
    "current_version", "published_version", "published_pack_url",
    "last_publish_attempt_at", "last_publish_succeeded_at",
    "approved_date", "published_date", "created_at", "updated_at"
  ],
  "Groom Knowledge": [
    "section_id", "profile_id", "section_name", "section_order", "section_text",
    "blade_numbers", "important_notes", "ai_confidence", "approved",
    "created_at", "updated_at"
  ],
  "Images": [
    "image_id", "profile_id", "image_role", "source_page_render_id",
    "crop_x", "crop_y", "crop_w", "crop_h", "drive_file_id",
    "display_position", "approved", "created_date", "last_recropped_date"
  ],
  "Page Renders": [
    "page_render_id", "profile_id", "page_index", "drive_file_id",
    "width_px", "height_px", "dpi", "created_at", "deleted_at"
  ],
  "Display Settings": [
    "profile_id", "image_panel_width", "text_panel_width", "main_image_id",
    "supplementary_order", "font_size", "show_blade_box", "show_warnings", "theme"
  ],
  "Extra Heading Approvals": [
    "approval_id", "profile_id", "suggested_heading", "suggested_text", "ai_reason",
    "telegram_message_id", "user_decision", "final_status",
    "decided_at", "created_at"
  ],
  "Version History": [
    "version_id", "profile_id", "change_type", "previous_value",
    "new_value", "actor", "reason", "created_at"
  ],
  "Breed Match Cache": [
    "cache_id", "raw_breed", "matched_breed_id", "matched_breed_name",
    "confidence", "source", "first_seen", "last_seen", "hit_count"
  ],
  "Backlog Signals": [
    "backlog_id", "raw_breed", "first_seen", "last_seen", "search_count",
    "current_status", "priority", "source", "resolved_breed_id"
  ],
  "Operational Alerts": [
    "alert_id", "severity", "source", "message", "payload_json",
    "created_at", "acknowledged_at", "acknowledged_by"
  ],
  "Jobs": [
    "job_id", "op", "payload", "status", "result", "error",
    "created_at", "started_at", "finished_at"
  ],
  "Telegram Outbox": [
    "outbox_id", "intended_chat_id", "message_text", "inline_buttons_json",
    "scheduled_for", "status", "sent_at", "error"
  ],
  "AI Call Log": [
    "call_id", "profile_id", "source", "model",
    "prompt_tokens", "completion_tokens", "cost_usd",
    "latency_ms", "success", "error_code", "created_at"
  ],
};

/**
 * One-shot setup. Idempotent — safe to re-run.
 * Output goes to Logger; check Apps Script execution log.
 */
function setupAll() {
  Logger.log("=== setupAll() running ===");
  ensureCryptoProperties_();
  ensureGitHubDefaults_();
  ensureWorkbook_();
  ensureSheets_();
  applyDefaultPasswordIfStaged_();
  ensureTriggers_();
  Logger.log("=== setupAll() complete ===");
  Logger.log("Next steps:");
  Logger.log("  1. Set Script Property GITHUB_PAT (fine-grained, Contents read+write on the repo)");
  Logger.log("  2. Deploy as Web App, then paste the URL into admin/js/config.js");
}

/**
 * Standalone shortcut: install the time-driven triggers without re-running
 * the rest of setupAll(). Idempotent — checks for existing triggers by
 * function name and skips creation if one is already in place.
 */
function setupTriggers() {
  Logger.log("=== setupTriggers() running ===");
  ensureTriggers_();
  Logger.log("=== setupTriggers() complete ===");
}

/**
 * Generate a SERVICE_TOKEN if not already set. The token is a 32-char
 * base64url string; non-interactive automations (n8n WF-04, future cron
 * helpers) can include it as `service_token` in the request body to skip
 * op_login. Rotate by deleting the Property and re-running this function,
 * or by setting the Property manually.
 *
 * Run once from the Apps Script editor; copy the printed value into your
 * n8n credential / environment variable.
 */
function setupServiceToken() {
  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty("SERVICE_TOKEN");
  if (token) {
    Logger.log("SERVICE_TOKEN already set. To rotate, delete it from Script Properties and re-run.");
    Logger.log("(Value preview, last 6 chars only): …" + token.slice(-6));
    return;
  }
  // 32 random bytes → base64url
  const bytes = Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
  token = bytes.slice(0, 64);
  props.setProperty("SERVICE_TOKEN", token);
  Logger.log("=== SERVICE_TOKEN generated ===");
  Logger.log(token);
  Logger.log("=== Copy the value above into n8n (and only n8n; never commit). ===");
}

/**
 * Idempotent trigger management. Currently:
 *   - resetLoginFailCounter: midnight (00:00–01:00 UTC) daily.
 * Add new triggers here; the function is safe to re-run because we look up
 * existing triggers by handler-function name before creating a new one.
 */
function ensureTriggers_() {
  const wanted = [
    {
      handler: "resetLoginFailCounter",
      describe: "midnight (00:00–01:00) daily",
      install: () => ScriptApp.newTrigger("resetLoginFailCounter")
        .timeBased()
        .atHour(0)
        .everyDays(1)
        .create(),
    },
  ];
  const existing = ScriptApp.getProjectTriggers();
  const existingByHandler = {};
  for (const t of existing) {
    existingByHandler[t.getHandlerFunction()] = t;
  }
  for (const w of wanted) {
    if (existingByHandler[w.handler]) {
      Logger.log(`  trigger '${w.handler}' already installed — skipping`);
      continue;
    }
    w.install();
    Logger.log(`  trigger '${w.handler}' installed (${w.describe})`);
  }
}

/**
 * If a Script Property `DEFAULT_PASSWORD` is set, hash + store it via
 * setAdminPassword(), then DELETE the property so the plaintext only lives
 * in the editor's Properties UI for the few seconds between paste and run —
 * never in source code, never committed.
 */
function applyDefaultPasswordIfStaged_() {
  const props = PropertiesService.getScriptProperties();
  const staged = props.getProperty("DEFAULT_PASSWORD");
  if (!staged) {
    if (props.getProperty("ADMIN_PASSWORD_HASH")) {
      Logger.log("[setup] Admin password already set — skipping.");
    } else {
      Logger.log("[setup] No DEFAULT_PASSWORD staged. Run setAdminPassword('your-password') manually, OR set Script Property DEFAULT_PASSWORD then re-run setupAll().");
    }
    return;
  }
  setAdminPassword(staged);
  props.deleteProperty("DEFAULT_PASSWORD");
  Logger.log("[setup] DEFAULT_PASSWORD applied and cleared.");
}

function ensureCryptoProperties_() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty("ADMIN_PASSWORD_SALT")) {
    setupSalt();
  } else {
    Logger.log("[setup] ADMIN_PASSWORD_SALT already set — skipping.");
  }
  if (!props.getProperty("SESSION_SECRET")) {
    setupSessionSecret();
  } else {
    Logger.log("[setup] SESSION_SECRET already set — skipping.");
  }
}

function ensureGitHubDefaults_() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty("GITHUB_OWNER")) props.setProperty("GITHUB_OWNER", DEFAULTS.GITHUB_OWNER);
  if (!props.getProperty("GITHUB_REPO"))  props.setProperty("GITHUB_REPO",  DEFAULTS.GITHUB_REPO);
  Logger.log("[setup] GITHUB_OWNER + GITHUB_REPO defaults set.");
}

function ensureWorkbook_() {
  const props = PropertiesService.getScriptProperties();
  let ssId = props.getProperty("SPREADSHEET_ID");
  if (ssId) {
    try {
      const ss = SpreadsheetApp.openById(ssId);
      Logger.log(`[setup] Workbook found: ${ss.getName()} (${ssId})`);
      return ss;
    } catch (err) {
      Logger.log(`[setup] SPREADSHEET_ID ${ssId} not openable — recreating.`);
    }
  }

  const driveRootId = props.getProperty("DRIVE_ROOT_ID");
  if (!driveRootId) {
    throw new Error("DRIVE_ROOT_ID not set. Set Script Property DRIVE_ROOT_ID to the Drive folder ID before running setupAll().");
  }
  const folder = DriveApp.getFolderById(driveRootId);

  // Create the spreadsheet, then move it into the Drive folder.
  const ss = SpreadsheetApp.create(DEFAULTS.WORKBOOK_NAME);
  const file = DriveApp.getFileById(ss.getId());
  // Move: add to target folder, remove from My Drive root.
  folder.addFile(file);
  DriveApp.getRootFolder().removeFile(file);

  ssId = ss.getId();
  props.setProperty("SPREADSHEET_ID", ssId);
  Logger.log(`[setup] Created workbook "${ss.getName()}" — id ${ssId}`);

  // Default `Sheet1` is replaced when we add real sheets; remove it later.
  return ss;
}

function ensureSheets_() {
  const ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID"));
  const existingNames = new Set(ss.getSheets().map((s) => s.getName()));

  for (const [name, headers] of Object.entries(SHEET_SCHEMAS)) {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      Logger.log(`[setup] Created sheet "${name}"`);
    }
    // Read existing header row and add any missing columns at the end.
    const lastCol = Math.max(1, sheet.getLastColumn());
    const existingHeaders = sheet.getLastRow() > 0
      ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String)
      : [];
    const missing = headers.filter((h) => !existingHeaders.includes(h));
    if (existingHeaders.length === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
      formatHeader_(sheet, headers.length);
      Logger.log(`[setup] Wrote ${headers.length} headers to "${name}"`);
    } else if (missing.length) {
      // Append missing columns (preserve existing ones).
      const newCols = existingHeaders.concat(missing);
      sheet.getRange(1, 1, 1, newCols.length).setValues([newCols]);
      formatHeader_(sheet, newCols.length);
      Logger.log(`[setup] Added ${missing.length} columns to "${name}": ${missing.join(", ")}`);
    } else {
      Logger.log(`[setup] Sheet "${name}" already has all expected columns.`);
    }
    existingNames.delete(name);
  }

  // Tidy up: remove the default `Sheet1` if empty.
  const defaultSheet = ss.getSheetByName("Sheet1");
  if (defaultSheet && defaultSheet.getLastRow() === 0) {
    if (ss.getSheets().length > 1) {
      ss.deleteSheet(defaultSheet);
      Logger.log(`[setup] Removed default Sheet1`);
    }
  }
}

function formatHeader_(sheet, ncols) {
  const range = sheet.getRange(1, 1, 1, ncols);
  range.setFontWeight("bold");
  range.setBackground("#0077B6");
  range.setFontColor("#FFFFFF");
  sheet.setRowHeight(1, 28);
}
