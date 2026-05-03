/**
 * lib/validate.gs — small input validation helpers.
 *
 * These throw `apiError_("VALIDATION_FAILED", ...)` on bad input. Callers
 * don't need to wrap them — the doPost handler catches and turns them into
 * a 200-with-error-body.
 */

function requireString_(value, label, { minLength = 1, maxLength = 5000 } = {}) {
  if (typeof value !== "string") throw apiError_("VALIDATION_FAILED", `${label} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length < minLength) throw apiError_("VALIDATION_FAILED", `${label} too short`);
  if (trimmed.length > maxLength) throw apiError_("VALIDATION_FAILED", `${label} too long`);
  return trimmed;
}

function requireEnum_(value, label, allowed) {
  if (!allowed.includes(value)) {
    throw apiError_("VALIDATION_FAILED", `${label} must be one of: ${allowed.join(", ")}`);
  }
  return value;
}

function requireInt_(value, label, { min = -Infinity, max = Infinity } = {}) {
  const n = Number(value);
  if (!Number.isInteger(n)) throw apiError_("VALIDATION_FAILED", `${label} must be an integer`);
  if (n < min || n > max) throw apiError_("VALIDATION_FAILED", `${label} out of range`);
  return n;
}

function optional_(value, fn) {
  if (value === null || value === undefined || value === "") return null;
  return fn(value);
}
