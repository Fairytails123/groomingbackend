/**
 * ids.gs — generate stable IDs (BRD-001, PRF-001, IMG-001, etc).
 *
 * Each ID prefix has a counter in Script Properties. Counter only ever
 * increments. ID format: `<prefix>-<counter zero-padded to 3>`.
 */

const ID_PREFIXES = {
  breed:       "BRD",
  profile:     "PRF",
  section:     "SEC",
  image:       "IMG",
  page_render: "PGR",
  approval:    "APR",
  version:     "VER",
  cache:       "MCH",
  backlog:     "BLG",
  alert:       "ALT",
  job:         "JOB",
};

function nextId_(kind) {
  const prefix = ID_PREFIXES[kind];
  if (!prefix) throw new Error(`Unknown ID kind: ${kind}`);
  const propKey = `ID_COUNTER_${prefix}`;
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const props = PropertiesService.getScriptProperties();
    const current = Number(props.getProperty(propKey) ?? "0");
    const next = current + 1;
    props.setProperty(propKey, String(next));
    return `${prefix}-${String(next).padStart(3, "0")}`;
  } finally {
    lock.releaseLock();
  }
}

/** Slugify a breed name. Lowercase, alphanumerics + hyphens, diacritics stripped. */
function slugify_(name) {
  return String(name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")  // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/**
 * Ensure a breed slug is unique. If already taken, append `-{breed_id}`
 * suffix per spec §7 Sheet 1 note.
 */
function uniqueBreedSlug_(name, breedId, existingSlugs) {
  let base = slugify_(name);
  if (!base) base = "breed";
  if (!existingSlugs.has(base)) return base;
  return `${base}-${breedId.toLowerCase()}`;
}
