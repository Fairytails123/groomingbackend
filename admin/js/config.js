// Runtime configuration. Edit APPS_SCRIPT_URL after the first `clasp deploy`.
// For local dev, you can override by creating admin/js/config.local.js (gitignored)
// that re-exports a different URL.

export const config = {
  // Apps Script Web App URL (POST endpoint). Filled in once Apps Script is deployed.
  APPS_SCRIPT_URL: "REPLACE_ME_WITH_APPS_SCRIPT_DEPLOYMENT_URL",

  // Image proxy URL — usually the same Apps Script URL with a `?id=...&token=...` query.
  // If a separate doGet deployment is used, point this to that deployment's URL.
  APPS_SCRIPT_IMAGE_PROXY_URL: "REPLACE_ME_WITH_APPS_SCRIPT_IMAGE_PROXY_URL",

  // Token expiry buffer — re-login when remaining lifetime drops below this.
  TOKEN_REFRESH_BUFFER_MS: 60 * 60 * 1000,  // 1 hour

  // Default request timeout
  REQUEST_TIMEOUT_MS: 30 * 1000,
};
