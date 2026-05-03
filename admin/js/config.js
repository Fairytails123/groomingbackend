// Runtime configuration. Edit APPS_SCRIPT_URL after the first `clasp deploy`.
// For local dev, you can override by creating admin/js/config.local.js (gitignored)
// that re-exports a different URL.

export const config = {
  // Apps Script Web App URL (POST endpoint). Deployed 2026-05-03 v1.
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycby5CU8J-xyCn38ruoe_HdDswRBCNcxXLO9O2AyiiHDt781mwsJzWeyyahySfwjpq4ZL/exec",

  // Image proxy URL — same Apps Script URL hits doGet which currently returns
  // a 404 stub for image serving (Stage 3 phase 2). For Stage 3 phase 1 the
  // snipping tool uses Drive direct URLs (https://drive.google.com/uc?export=view&id=...).
  APPS_SCRIPT_IMAGE_PROXY_URL: "https://script.google.com/macros/s/AKfycby5CU8J-xyCn38ruoe_HdDswRBCNcxXLO9O2AyiiHDt781mwsJzWeyyahySfwjpq4ZL/exec",

  // Token expiry buffer — re-login when remaining lifetime drops below this.
  TOKEN_REFRESH_BUFFER_MS: 60 * 60 * 1000,  // 1 hour

  // Default request timeout
  REQUEST_TIMEOUT_MS: 30 * 1000,
};
