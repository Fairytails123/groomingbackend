/**
 * private-tv-publish.gs — reconcile the admin database with an integrity-
 * verified, PIN-hosted salon-TV release.
 *
 * This is deliberately a control-plane operation. It records hashes and
 * publication state only; it never copies book text or images to GitHub.
 * The private TV deployment remains the runtime source of truth.
 */

const PRIVATE_TV_BASE_URL = "https://auto.thefairytails.co.uk/salon-tv";
const SHA256_RE = /^[a-f0-9]{64}$/;
const RELEASE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const BREED_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function op_register_private_tv_release(body) {
  const release = validatePrivateTvReleasePayload_(body.release);
  ensureSheets_();

  return withScriptLock_(60000, () => {
    const entriesRead = readSheet_("Reference Entries");
    const profilesRead = readSheet_("Groom Profiles");
    const breedsRead = readSheet_("Breeds");
    const sourcesRead = readSheet_("Reference Sources");
    const releasesRead = readSheet_("Private TV Releases");

    if (!sourcesRead.rows.some((source) =>
      String(source.source_pdf_sha256 || "").toLowerCase() === release.source_pdf_sha256)) {
      throw apiError_("VALIDATION_FAILED", "Private TV release source PDF is not registered");
    }

    const sameId = releasesRead.rows.find((row) => row.release_id === release.release_id);
    if (sameId && (String(sameId.manifest_sha256) !== release.manifest_sha256
        || String(sameId.checksums_sha256) !== release.checksums_sha256)) {
      throw apiError_("CONFLICT", "Release ID is already registered with different integrity hashes");
    }

    const plan = privateTvReleasePlan_(
      release,
      entriesRead.rows,
      profilesRead.rows,
      breedsRead.rows,
    );
    const now = nowIso_();
    const profilesSheet = profilesRead.sheet;
    const profileValues = profilesSheet.getDataRange().getValues();
    const profileHeaderIndex = Object.fromEntries(
      profilesRead.headers.map((header, index) => [header, index]));
    const transitions = [];

    for (const item of plan.linked) {
      const profile = item.profile;
      const exactMatch = profile.status === "Published"
        && profile.publication_target === "private-tv"
        && profile.private_tv_release_id === release.release_id
        && String(profile.private_tv_pack_sha256 || "").toLowerCase() === item.pack_sha256;
      if (exactMatch) continue;

      const previousVersion = Number(profile.current_version || 1);
      const nextVersion = previousVersion + 1;
      const patch = {
        status: "Published",
        error_message: "",
        current_version: nextVersion,
        published_version: nextVersion,
        published_pack_url: `${PRIVATE_TV_BASE_URL}/breed.html?slug=${encodeURIComponent(item.slug)}`,
        publication_target: "private-tv",
        private_tv_release_id: release.release_id,
        private_tv_pack_sha256: item.pack_sha256,
        last_publish_attempt_at: now,
        last_publish_succeeded_at: now,
        approved_date: profile.approved_date || now,
        published_date: now,
        updated_at: now,
      };
      const row = profileValues[profile._rowIndex - 1];
      for (const [key, value] of Object.entries(patch)) {
        const column = profileHeaderIndex[key];
        if (column === undefined) throw apiError_("INTERNAL", `Groom Profiles column missing: ${key}`);
        row[column] = value;
      }
      transitions.push({ profile, previousVersion, nextVersion, slug: item.slug });
    }

    // One bounded write for all profile transitions. This avoids 154 separate
    // Sheets round trips while the script lock is held.
    if (transitions.length) {
      profilesSheet.getRange(2, 1, profileValues.length - 1, profilesRead.headers.length)
        .setValues(profileValues.slice(1));
      appendPrivateTvHistory_(release.release_id, transitions, now);
    }

    const releaseRow = {
      release_id: release.release_id,
      manifest_sha256: release.manifest_sha256,
      checksums_sha256: release.checksums_sha256,
      source_pdf_sha256: release.source_pdf_sha256,
      generated_at: release.generated_at,
      breed_count: release.breed_count,
      profile_count: release.profile_count,
      section_count: release.section_count,
      image_count: release.image_count,
      breed_pack_sha256_json: JSON.stringify(release.breed_pack_sha256),
      live_base_url: PRIVATE_TV_BASE_URL,
      registered_at: sameId?.registered_at || now,
      last_reconciled_at: now,
    };
    if (sameId) {
      writeRow_(releasesRead.sheet, releasesRead.headers, sameId._rowIndex, releaseRow);
    } else {
      appendRow_(releasesRead.sheet, releasesRead.headers, releaseRow);
    }

    return {
      release_id: release.release_id,
      live_base_url: PRIVATE_TV_BASE_URL,
      breed_count: release.breed_count,
      linked_reference_profiles: plan.linked.length,
      existing_profile_coverage: plan.existing.length,
      profiles_transitioned: transitions.length,
      profiles_already_current: plan.linked.length - transitions.length,
      unchanged: !!sameId && transitions.length === 0,
    };
  });
}

function op_private_tv_release_status() {
  ensureSheets_();
  const { rows } = readSheet_("Private TV Releases");
  if (!rows.length) return { registered: false, live_base_url: PRIVATE_TV_BASE_URL };
  const latest = rows.slice().sort((a, b) =>
    String(b.registered_at || "").localeCompare(String(a.registered_at || "")))[0];
  return {
    registered: true,
    release_id: latest.release_id,
    manifest_sha256: latest.manifest_sha256,
    checksums_sha256: latest.checksums_sha256,
    generated_at: toIso_(latest.generated_at) || String(latest.generated_at || ""),
    breed_count: Number(latest.breed_count || 0),
    profile_count: Number(latest.profile_count || 0),
    section_count: Number(latest.section_count || 0),
    image_count: Number(latest.image_count || 0),
    live_base_url: latest.live_base_url || PRIVATE_TV_BASE_URL,
    registered_at: toIso_(latest.registered_at),
    last_reconciled_at: toIso_(latest.last_reconciled_at),
  };
}

function validatePrivateTvReleasePayload_(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw apiError_("VALIDATION_FAILED", "release object required");
  }
  const release = {
    release_id: String(raw.release_id || "").trim(),
    manifest_sha256: String(raw.manifest_sha256 || "").trim().toLowerCase(),
    checksums_sha256: String(raw.checksums_sha256 || "").trim().toLowerCase(),
    source_pdf_sha256: String(raw.source_pdf_sha256 || "").trim().toLowerCase(),
    generated_at: String(raw.generated_at || "").trim(),
    breed_count: Number(raw.breed_count),
    profile_count: Number(raw.profile_count),
    section_count: Number(raw.section_count),
    image_count: Number(raw.image_count),
    breed_pack_sha256: raw.breed_pack_sha256,
  };
  if (!RELEASE_ID_RE.test(release.release_id)) {
    throw apiError_("VALIDATION_FAILED", "release_id is invalid");
  }
  for (const field of ["manifest_sha256", "checksums_sha256", "source_pdf_sha256"]) {
    if (!SHA256_RE.test(release[field])) {
      throw apiError_("VALIDATION_FAILED", `${field} must be a lowercase SHA-256`);
    }
  }
  if (!release.generated_at || Number.isNaN(Date.parse(release.generated_at))) {
    throw apiError_("VALIDATION_FAILED", "generated_at must be an ISO timestamp");
  }
  for (const field of ["breed_count", "profile_count", "section_count", "image_count"]) {
    if (!Number.isInteger(release[field]) || release[field] < 0) {
      throw apiError_("VALIDATION_FAILED", `${field} must be a non-negative integer`);
    }
  }
  if (!release.breed_pack_sha256 || typeof release.breed_pack_sha256 !== "object"
      || Array.isArray(release.breed_pack_sha256)) {
    throw apiError_("VALIDATION_FAILED", "breed_pack_sha256 object required");
  }
  const slugs = Object.keys(release.breed_pack_sha256);
  if (slugs.length !== release.breed_count || slugs.length === 0) {
    throw apiError_("VALIDATION_FAILED", "breed_count does not match breed pack hashes");
  }
  const normalized = {};
  for (const slug of slugs.sort()) {
    const hash = String(release.breed_pack_sha256[slug] || "").toLowerCase();
    if (!BREED_SLUG_RE.test(slug) || !SHA256_RE.test(hash)) {
      throw apiError_("VALIDATION_FAILED", `Invalid private TV breed pack entry: ${slug}`);
    }
    normalized[slug] = hash;
  }
  release.breed_pack_sha256 = normalized;
  return release;
}

function privateTvReleasePlan_(release, entries, profiles, breeds) {
  const slugs = Object.keys(release.breed_pack_sha256);
  const approved = entries.filter((entry) => entry.review_status === "approved");
  const entryBySlug = new Map();
  for (const entry of approved) {
    if (entryBySlug.has(entry.breed_slug)) {
      throw apiError_("CONFLICT", `Duplicate approved reference entry: ${entry.breed_slug}`);
    }
    entryBySlug.set(entry.breed_slug, entry);
  }
  if (approved.length !== slugs.length) {
    throw apiError_("VALIDATION_FAILED",
      `Release has ${slugs.length} breeds but the approved catalogue has ${approved.length}`);
  }

  const profilesById = new Map(profiles.map((profile) => [profile.profile_id, profile]));
  const breedsBySlug = new Map(breeds.map((breed) => [breed.slug, breed]));
  const linked = [];
  const existing = [];
  for (const slug of slugs) {
    const entry = entryBySlug.get(slug);
    if (!entry) throw apiError_("VALIDATION_FAILED", `Release breed is not approved: ${slug}`);
    if (entry.profile_id) {
      const profile = profilesById.get(entry.profile_id);
      if (!profile) throw apiError_("NOT_FOUND", `Linked profile not found for ${slug}`);
      if (profile.source_type !== "reference-catalog") {
        throw apiError_("CONFLICT", `Linked profile is not reference-catalog: ${slug}`);
      }
      if (profile.status === "Archived") {
        throw apiError_("CONFLICT", `Linked profile is archived: ${slug}`);
      }
      linked.push({ slug, pack_sha256: release.breed_pack_sha256[slug], profile });
      continue;
    }

    // Miniature Schnauzer is the known collision: its approved reference entry
    // intentionally links to no generated profile because an existing Pet Groom
    // profile was already Published. Require that coverage rather than silently
    // treating any unlinked catalogue row as live.
    const breed = breedsBySlug.get(slug);
    const coverage = breed && profiles.find((profile) =>
      profile.breed_id === breed.breed_id && profile.status === "Published"
      && profile.status !== "Archived");
    if (!coverage) {
      throw apiError_("VALIDATION_FAILED", `Approved release breed has no publishable profile: ${slug}`);
    }
    existing.push({ slug, profile_id: coverage.profile_id });
  }
  return { linked, existing };
}

function appendPrivateTvHistory_(releaseId, transitions, timestamp) {
  if (!transitions.length) return;
  const read = readSheet_("Version History");
  const start = reservePrivateTvVersionIds_(transitions.length);
  const rows = transitions.map((transition, offset) => {
    const values = {
      version_id: `VER-${String(start + offset).padStart(3, "0")}`,
      profile_id: transition.profile.profile_id,
      change_type: "private_tv_publish",
      previous_value: JSON.stringify({
        status: transition.profile.status,
        current_version: transition.previousVersion,
      }),
      new_value: JSON.stringify({
        status: "Published",
        current_version: transition.nextVersion,
        publication_target: "private-tv",
        private_tv_release_id: releaseId,
        breed_slug: transition.slug,
      }),
      actor: "private-tv-release",
      reason: `Verified private TV release ${releaseId}`,
      created_at: timestamp,
    };
    return read.headers.map((header) => values[header] ?? "");
  });
  read.sheet.getRange(read.sheet.getLastRow() + 1, 1, rows.length, read.headers.length)
    .setValues(rows);
}

// Called only while op_register_private_tv_release holds the script lock.
function reservePrivateTvVersionIds_(count) {
  const props = PropertiesService.getScriptProperties();
  const key = "ID_COUNTER_VER";
  const current = Number(props.getProperty(key) || 0);
  props.setProperty(key, String(current + count));
  return current + 1;
}
