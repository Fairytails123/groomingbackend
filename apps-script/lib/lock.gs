/**
 * lib/lock.gs — LockService helpers.
 *
 * The script-wide LockService is the only mutex available; we use it as both
 * a global write lock (for ID counters etc.) and a per-profile lock keyed via
 * a Properties guard.
 */

function withScriptLock_(timeoutMs, fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(timeoutMs)) {
    throw apiError_("INTERNAL", "Could not acquire script lock");
  }
  try { return fn(); } finally { lock.releaseLock(); }
}

/**
 * Per-profile lock implemented as a Properties-stored owner timestamp.
 * Best-effort — multiple writers within the lock TTL will queue via the
 * underlying script lock.
 */
function withProfileLock_(profileId, timeoutMs, fn) {
  return withScriptLock_(timeoutMs, () => {
    const props = PropertiesService.getScriptProperties();
    const key = `LOCK_PROFILE_${profileId}`;
    const heldBy = props.getProperty(key);
    const now = Date.now();
    if (heldBy) {
      const heldAt = Number(heldBy);
      if (!Number.isNaN(heldAt) && now - heldAt < 30000) {
        throw apiError_("CONFLICT", `Profile ${profileId} is locked by another operation`);
      }
    }
    props.setProperty(key, String(now));
    try {
      return fn();
    } finally {
      props.deleteProperty(key);
    }
  });
}
