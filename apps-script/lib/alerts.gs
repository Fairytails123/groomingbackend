/**
 * lib/alerts.gs — Operational Alerts logging helper.
 *
 * Wraps the append-to-sheet pattern previously inlined in publish.gs and
 * session_pack.gs so callers don't have to know the column shape. Used by
 * the AI extraction ops, the publish flow, and the cron handlers.
 *
 * Never throws — alert logging failures shouldn't tank the user's request.
 */

function logOperationalAlert_(severity, source, message, payload) {
  try {
    const sheet = getDb_().getSheetByName("Operational Alerts");
    if (!sheet) return null;
    const headers = readSheet_("Operational Alerts").headers;
    const id = nextId_("alert");
    appendRow_(sheet, headers, {
      alert_id: id,
      severity: String(severity ?? "info"),
      source: String(source ?? ""),
      message: String(message ?? ""),
      payload_json: payload ? JSON.stringify(payload) : "",
      created_at: nowIso_(),
      acknowledged_at: "",
      acknowledged_by: "",
    });
    return id;
  } catch (err) {
    Logger.log(`[alerts] failed to log: ${err}`);
    return null;
  }
}
