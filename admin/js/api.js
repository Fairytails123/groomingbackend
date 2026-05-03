// Apps Script API client. Single POST endpoint, dispatches on `op` field.
// See docs/api.md for the operation catalogue.

import { config } from "./config.js";
import { getToken, setSession, clearSession } from "./auth.js";
import { toastError } from "./ui.js";

class ApiError extends Error {
  constructor(code, message, requestId) {
    super(message);
    this.code = code;
    this.requestId = requestId;
  }
}

/**
 * Call an Apps Script op.
 *   await api("list_breeds", { filter: { status: "Published" } });
 *   await api("login", { password: "..." });
 *
 * Throws ApiError on non-ok responses. Surfaces a toast on network failures.
 * On UNAUTHORIZED: clears the session and redirects to login.
 *
 * `opts.timeoutMs` overrides the default config timeout — needed for slow
 * AI ops (extract_sections, run_vision_pass_page can take 5-30s).
 */
export async function api(op, body = {}, opts = {}) {
  if (!config.APPS_SCRIPT_URL || config.APPS_SCRIPT_URL.startsWith("REPLACE_ME")) {
    const msg = "API URL not configured — edit admin/js/config.js after deploying Apps Script.";
    toastError(msg);
    throw new ApiError("INTERNAL", msg);
  }

  const payload = { op, ...body };
  // Auth ops (login, ping) don't carry a token.
  if (op !== "login" && op !== "ping") {
    const token = getToken();
    if (token) payload.auth_token = token;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? config.REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(config.APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      // Apps Script Web Apps require text/plain to avoid the CORS preflight.
      // The server JSON.parses the body.
      body: JSON.stringify(payload),
      signal: ctrl.signal,
      credentials: "omit",
    });
  } catch (err) {
    clearTimeout(timer);
    const isAbort = err.name === "AbortError";
    const msg = isAbort ? "Request timed out" : "Network error";
    toastError(msg);
    throw new ApiError(isAbort ? "TIMEOUT" : "INTERNAL", msg);
  }
  clearTimeout(timer);

  let json;
  try {
    json = await response.json();
  } catch (err) {
    toastError("Server returned malformed response");
    throw new ApiError("INTERNAL", "Bad JSON from server");
  }

  if (!json.ok) {
    const code = json.error?.code ?? "INTERNAL";
    const msg  = json.error?.message ?? "Unknown error";
    if (code === "UNAUTHORIZED") {
      // Token is bad/expired/missing. Clear and bounce to login.
      clearSession();
      // Avoid bounce-loop if we're already on login.html.
      if (!location.pathname.endsWith("login.html")) {
        location.replace("login.html");
      }
    } else {
      // Validation errors are surfaced by the caller; everything else gets a toast.
      if (code !== "VALIDATION_FAILED" && code !== "CONFLICT") {
        toastError(msg);
      }
    }
    throw new ApiError(code, msg, json.request_id);
  }

  // Special handling for login — persist the token automatically.
  if (op === "login" && json.data?.token) {
    setSession(json.data.token, json.data.expires_at);
  }

  return json.data ?? {};
}

export { ApiError };
