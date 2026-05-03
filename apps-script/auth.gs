/**
 * auth.gs — login, logout, token mint/verify, password setup helpers.
 *
 * Token format:
 *   token = base64url(payload).base64url(HMAC_SHA256(SESSION_SECRET, payload))
 *   payload = JSON.stringify({ iat, exp, scope: "admin" })
 *   exp = iat + 12h
 *
 * Tokens are stateless (no server-side session table). Brute-force protection:
 * 50 login fails/day in Script Properties; reset by midnight cron.
 */

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;   // 12h
const MAX_LOGIN_FAILS_PER_DAY = 50;

// ─── Public ops ─────────────────────────────────────────────────────

function op_login(body) {
  const password = body.password ?? "";
  if (!password) throw apiError_("VALIDATION_FAILED", "Password required");

  const day = new Date().toISOString().slice(0, 10);
  const failKey = `LOGIN_FAILS_${day}`;
  const fails = Number(PropertiesService.getScriptProperties().getProperty(failKey) ?? "0");
  if (fails >= MAX_LOGIN_FAILS_PER_DAY) {
    throw apiError_("QUOTA_EXCEEDED", "Too many failed sign-ins today. Try again tomorrow.");
  }

  if (!verifyAdminPassword_(password)) {
    PropertiesService.getScriptProperties().setProperty(failKey, String(fails + 1));
    throw apiError_("UNAUTHORIZED", "Incorrect password");
  }

  const now = Date.now();
  const exp = now + TOKEN_TTL_MS;
  const token = mintToken_({ iat: now, exp, scope: "admin" });
  return { token, expires_at: new Date(exp).toISOString() };
}

function op_logout(body) {
  // Stateless tokens — no server-side revocation. (If we ever need it, add a
  // small denylist of jti values keyed in Script Properties.)
  return {};
}

function op_ping(body) {
  return {
    server_time: new Date().toISOString(),
    build: "stage-2-week-1",
  };
}

// ─── Token mint / verify ────────────────────────────────────────────

function mintToken_(payload) {
  const secret = getSessionSecret_();
  const payloadStr = JSON.stringify(payload);
  const payloadB64 = base64UrlEncode_(payloadStr);
  const sigBytes = Utilities.computeHmacSha256Signature(payloadStr, secret);
  const sigB64 = base64UrlEncode_(sigBytes);
  return `${payloadB64}.${sigB64}`;
}

/** Returns { iat, exp, scope } if valid, null otherwise. */
function verifyToken_(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  const payloadStr = base64UrlDecodeToString_(payloadB64);
  if (!payloadStr) return null;

  const secret = getSessionSecret_();
  const expectedSig = Utilities.computeHmacSha256Signature(payloadStr, secret);
  const expectedSigB64 = base64UrlEncode_(expectedSig);

  // Constant-time comparison
  if (!constantTimeEq_(sigB64, expectedSigB64)) return null;

  let payload;
  try { payload = JSON.parse(payloadStr); } catch { return null; }
  if (!payload.exp || payload.exp < Date.now()) return null;
  return payload;
}

// ─── Password storage ───────────────────────────────────────────────

function verifyAdminPassword_(password) {
  const props = PropertiesService.getScriptProperties();
  const salt = props.getProperty("ADMIN_PASSWORD_SALT");
  const hash = props.getProperty("ADMIN_PASSWORD_HASH");
  if (!salt || !hash) {
    throw apiError_("INTERNAL", "Admin password not configured. Run setupAdminPassword() once.");
  }
  const got = sha256Hex_(salt + password);
  return constantTimeEq_(got, hash);
}

function getSessionSecret_() {
  const props = PropertiesService.getScriptProperties();
  const secret = props.getProperty("SESSION_SECRET");
  if (!secret) {
    throw apiError_("INTERNAL", "SESSION_SECRET not configured. Run setupSessionSecret() once.");
  }
  return secret;
}

// ─── Setup functions (run manually in Apps Script editor) ───────────

/**
 * One-time setup. Generates and stores SESSION_SECRET (32-byte random).
 * Run this from the Apps Script editor before first login.
 */
function setupSessionSecret() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty("SESSION_SECRET")) {
    Logger.log("SESSION_SECRET already set. Doing nothing.");
    return;
  }
  const bytes = new Array(32).fill(0).map(() => Math.floor(Math.random() * 256));
  // Use Apps Script Utilities for a slightly less-bad source than Math.random.
  // Better: generate in a scratch fn, copy/paste, then delete the fn.
  const secret = Utilities.base64Encode(bytes);
  props.setProperty("SESSION_SECRET", secret);
  Logger.log("SESSION_SECRET created.");
}

/**
 * One-time setup. Generates and stores ADMIN_PASSWORD_SALT.
 * Run BEFORE setAdminPassword().
 */
function setupSalt() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty("ADMIN_PASSWORD_SALT")) {
    Logger.log("ADMIN_PASSWORD_SALT already set. Doing nothing.");
    return;
  }
  const bytes = new Array(32).fill(0).map(() => Math.floor(Math.random() * 256));
  const salt = Utilities.base64Encode(bytes);
  props.setProperty("ADMIN_PASSWORD_SALT", salt);
  Logger.log("ADMIN_PASSWORD_SALT created.");
}

/**
 * Set the admin password. Call from Apps Script editor:
 *   setAdminPassword('your-password-here');
 */
function setAdminPassword(plaintext) {
  if (!plaintext || plaintext.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }
  const props = PropertiesService.getScriptProperties();
  let salt = props.getProperty("ADMIN_PASSWORD_SALT");
  if (!salt) {
    setupSalt();
    salt = props.getProperty("ADMIN_PASSWORD_SALT");
  }
  const hash = sha256Hex_(salt + plaintext);
  props.setProperty("ADMIN_PASSWORD_HASH", hash);
  Logger.log("Admin password set.");
}

/**
 * Reset daily login-fail counter — bound to a midnight time trigger.
 */
function resetLoginFailCounter() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  for (const key of Object.keys(all)) {
    if (key.startsWith("LOGIN_FAILS_")) props.deleteProperty(key);
  }
}

// ─── Crypto / encoding helpers ──────────────────────────────────────

function sha256Hex_(input) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input);
  return bytes.map((b) => ("0" + (b & 0xff).toString(16)).slice(-2)).join("");
}

function base64UrlEncode_(input) {
  // input may be a string or byte array
  const b64 = typeof input === "string"
    ? Utilities.base64Encode(input)
    : Utilities.base64Encode(input);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecodeToString_(s) {
  try {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - s.length % 4) % 4);
    const bytes = Utilities.base64Decode(b64);
    return Utilities.newBlob(bytes).getDataAsString();
  } catch { return null; }
}

function constantTimeEq_(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
