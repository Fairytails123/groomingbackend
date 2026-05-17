/**
 * Code.gs — entry point. doPost dispatches on the `op` field. doGet is the
 * image proxy (stubbed until Stage 3 snipping tool wires it).
 *
 * See docs/api.md for the full operation catalogue.
 */

/** All ops that exist. New ops register themselves here. */
const OP_REGISTRY = {
  // Auth
  login:    op_login,
  logout:   op_logout,
  ping:     op_ping,

  // Breeds + matcher
  list_breeds:           op_list_breeds,
  save_breed:            op_save_breed,
  search_breeds:         op_search_breeds,
  override_breed_match:  op_override_breed_match,

  // Profiles
  get_breed_profile:     op_get_breed_profile,
  save_profile:          op_save_profile,
  list_groom_types:      op_list_groom_types,
  create_profile:        op_create_profile,
  archive_profile:       op_archive_profile,
  restore_profile:       op_restore_profile,
  duplicate_profile:     op_duplicate_profile,

  // Publish (Week 3)
  publish_profile:       op_publish_profile,
  unpublish_profile:     op_unpublish_profile,
  list_drafts:           op_list_drafts,

  // Images (Week 3 — pre-Cropper. Stage 3 adds save_crop)
  save_image_record:     op_save_image_record,
  list_images:           op_list_images,
  delete_image:          op_delete_image,

  // Stage 3 — snipping tool
  list_page_renders:     op_list_page_renders,
  save_page_render:      op_save_page_render,
  save_crop:             op_save_crop,
  list_crops_for_render: op_list_crops_for_render,
  delete_page_render:    op_delete_page_render,
  purge_orphaned_drive_files: op_purge_orphaned_drive_files,

  // Stage 4 — cron handlers
  rebuild_today_json:        op_rebuild_today_json,
  rebuild_tomorrow_json:     op_rebuild_tomorrow_json,
  send_tomorrow_prep_alert:  op_send_tomorrow_prep_alert,

  // Public endpoint for TV manual-search backlog signal
  log_backlog_hit:       op_log_backlog_hit,

  // Stage 3 Phase 2 — PDF intake (browser-orchestrated)
  upload_pdf:            op_upload_pdf,
  get_source_pdf:        op_get_source_pdf,
  extract_sections:      op_extract_sections,
  run_vision_pass_page:  op_run_vision_pass_page,
  finalize_pdf_intake:   op_finalize_pdf_intake,
  list_pending_headings: op_list_pending_headings,
  decide_heading:        op_decide_heading,
  job_status:            op_not_implemented,  // unused; Phase 2 is synchronous

  // Dashboard
  dashboard_summary:          op_dashboard_summary,
  dashboard_today_prep:       op_dashboard_today_prep,
  dashboard_tomorrow_prep:    op_dashboard_tomorrow_prep,
  dashboard_status_counts:    op_dashboard_status_counts,
  dashboard_recent_uploads:   op_dashboard_recent_uploads,
  dashboard_backlog:          op_dashboard_backlog,
  dashboard_alerts:           op_dashboard_alerts,
  acknowledge_alert:          op_acknowledge_alert,
  health_check:               op_health_check,
  get_version_history:        op_get_version_history,
};

/** Ops that do NOT require auth. */
const PUBLIC_OPS = new Set([
  "login",
  "ping",
  "health_check",
  "log_backlog_hit",         // TV calls this with no auth
  "rebuild_today_json",      // n8n cron calls these — could be tightened with a service secret
  "rebuild_tomorrow_json",
  "send_tomorrow_prep_alert",
]);

function doPost(e) {
  const requestId = newRequestId_();
  let body = {};
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse_({ ok: false, request_id: requestId, error: { code: "VALIDATION_FAILED", message: "Body must be JSON" } });
  }

  const op = body.op;
  const handler = OP_REGISTRY[op];

  if (!handler) {
    return jsonResponse_({ ok: false, request_id: requestId, error: { code: "NOT_FOUND", message: `Unknown op: ${op}` } });
  }

  try {
    if (!PUBLIC_OPS.has(op)) {
      // Two auth paths:
      //   1. auth_token — short-lived (12h) HMAC-signed session from op_login. Used by
      //      the admin website where the user has signed in.
      //   2. service_token — static value matching Script Property SERVICE_TOKEN. Used
      //      by n8n WF-04 and other non-interactive automations so they don't need to
      //      cycle through op_login on every run. Rotate the Property to revoke.
      let session = verifyToken_(body.auth_token);
      if (!session && body.service_token) {
        const stored = PropertiesService.getScriptProperties().getProperty("SERVICE_TOKEN");
        if (stored && String(body.service_token) === stored) {
          session = { scope: "service", is_service: true };
        }
      }
      if (!session) {
        return jsonResponse_({ ok: false, request_id: requestId, error: { code: "UNAUTHORIZED", message: "Invalid or expired session" } });
      }
      body._session = session;
    }
    const data = handler(body) ?? {};
    return jsonResponse_({ ok: true, request_id: requestId, data });
  } catch (err) {
    if (err && err.apiError) {
      return jsonResponse_({ ok: false, request_id: requestId, error: { code: err.code, message: err.message } });
    }
    console.error("[doPost] unhandled", err && err.stack ? err.stack : err);
    return jsonResponse_({ ok: false, request_id: requestId, error: { code: "INTERNAL", message: "Server error" } });
  }
}

function doGet(e) {
  // Stage 2: a tiny readiness page so we can confirm the deployment URL works.
  // Stage 3 will replace this with the image proxy (see docs/api.md §Image proxy).
  const id = e?.parameter?.id;
  if (!id) {
    return ContentService.createTextOutput(
      JSON.stringify({ ok: true, message: "Grooming Backend API. POST with {op:...} or GET ?id=<drive_file_id> for image proxy (Stage 3)." })
    ).setMimeType(ContentService.MimeType.JSON);
  }
  // Image proxy stub
  return ContentService.createTextOutput(
    JSON.stringify({ ok: false, error: { code: "NOT_IMPLEMENTED", message: "Image proxy lands in Stage 3 with the snipping tool." } })
  ).setMimeType(ContentService.MimeType.JSON);
}

// ─── Helpers ────────────────────────────────────────────────────────

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function newRequestId_() {
  return "REQ-" + Utilities.getUuid().slice(0, 12);
}

function apiError_(code, message) {
  const err = new Error(message);
  err.apiError = true;
  err.code = code;
  return err;
}

function op_not_implemented(body) {
  throw apiError_("NOT_FOUND", `op '${body.op}' not implemented yet — coming in a later stage.`);
}
