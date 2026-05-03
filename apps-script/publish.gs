/**
 * publish.gs — atomic publish (spec §6.10).
 *
 * Order of operations:
 *   1. Acquire profile lock (30s timeout).
 *   2. Validate (main image present, all five core sections non-empty,
 *      crop bounds within page, groom_type in vocab).
 *   3. Compute candidate_version = current_version + 1.
 *   4. Build per-breed JSON (this profile + every other Published profile
 *      for the same breed).
 *   5. Stage to Drive (05-approved-output/, 06-version-history/).
 *   6. Copy required image JPEGs into the GitHub working tree (in-memory).
 *   7. Commit to GitHub: PUT public/breeds/{slug}.json, then each new image.
 *   8. After all GitHub PUTs return 200: write Sheets.
 *   9. Trigger today.json rewrite if breed appears in today/tomorrow bookings.
 *   10. Release lock.
 */

const VALID_GROOM_TYPES = ["Pet Groom", "Show", "Sporting", "Puppy", "Maintenance", "Hand Strip"];

// ─── op: publish_profile ────────────────────────────────────────────

function op_publish_profile(body) {
  const profileId = String(body.profile_id ?? "").trim();
  const expectedVersion = Number(body.expected_version ?? 0);
  if (!profileId) throw apiError_("VALIDATION_FAILED", "profile_id required");

  return withProfileLock_(profileId, 60000, () => {
    const profilesSheet = getDb_().getSheetByName("Groom Profiles");
    const { headers: profilesHeaders, rows: profiles } = readSheet_("Groom Profiles");
    const profile = profiles.find((p) => p.profile_id === profileId);
    if (!profile) throw apiError_("NOT_FOUND", `profile '${profileId}' not found`);

    const currentVersion = Number(profile.current_version ?? 1);
    if (expectedVersion && expectedVersion !== currentVersion) {
      throw apiError_("CONFLICT", `version mismatch — expected ${expectedVersion}, got ${currentVersion}`);
    }

    const breed = findBreed_(profile.breed_id);

    // Step 2: validate
    const validationErrors = validatePublishable_(profile, breed);
    if (validationErrors.length) {
      throw apiError_("VALIDATION_FAILED", "Cannot publish: " + validationErrors.join("; "));
    }

    const candidateVersion = currentVersion + 1;

    // Step 4: build per-breed JSON
    const breedPack = buildBreedPack_(breed, profile, candidateVersion);

    // Step 5: stage to Drive (best-effort — failure here is recoverable)
    try {
      stageToDrive_(profile, breedPack, candidateVersion);
    } catch (err) {
      Logger.log("[publish] Drive stage failed (non-fatal): " + err);
    }

    // Track attempt before risky GitHub writes
    writeRow_(profilesSheet, profilesHeaders, profile._rowIndex, {
      last_publish_attempt_at: nowIso_(),
    });

    // Steps 6+7: commit JSON + each image to GitHub
    const path = `public/breeds/${breed.slug}.json`;
    const commitMsg = `Publish ${breed.breed_name} / ${profile.groom_type} v${candidateVersion}`;
    let pushedImages = [];
    try {
      // Push images first so the breed JSON, when fetched, points to live files.
      pushedImages = publishImagesToGitHub_(breed, breedPack);
      // Push the breed JSON last.
      ghPutFile_(path, JSON.stringify(breedPack, null, 2), commitMsg);
    } catch (err) {
      writeRow_(profilesSheet, profilesHeaders, profile._rowIndex, {
        error_message: String(err.message ?? err).slice(0, 250),
      });
      throw err;
    }

    // Step 8: commit to Sheets
    const publishedPackUrl = `https://${PropertiesService.getScriptProperties().getProperty("GITHUB_OWNER")}.github.io/${PropertiesService.getScriptProperties().getProperty("GITHUB_REPO")}/public/breeds/${breed.slug}.json`;
    writeRow_(profilesSheet, profilesHeaders, profile._rowIndex, {
      status: "Published",
      published_version: candidateVersion,
      current_version: candidateVersion,
      published_pack_url: publishedPackUrl,
      published_date: nowIso_(),
      last_publish_succeeded_at: nowIso_(),
      error_message: "",
      updated_at: nowIso_(),
    });

    // Append publish row to Version History
    const historySheet = getDb_().getSheetByName("Version History");
    const historyHeaders = readSheet_("Version History").headers;
    appendRow_(historySheet, historyHeaders, {
      version_id: nextId_("version"),
      profile_id: profileId,
      change_type: "publish",
      previous_value: JSON.stringify({ status: profile.status, current_version: currentVersion }),
      new_value: JSON.stringify({ status: "Published", current_version: candidateVersion }),
      actor: "kamal",
      reason: body.reason ?? "",
      created_at: nowIso_(),
    });

    // Step 9: enqueue today.json rewrite if breed appears in today/tomorrow bookings.
    // Until WF-01 exists this is a no-op stub. When WF-01 is wired we replace this
    // with a UrlFetchApp call to the n8n webhook.
    enqueueSessionPackRebuildIfBooked_(breed.breed_id);

    return {
      profile_id: profileId,
      published_pack_url: publishedPackUrl,
      published_version: candidateVersion,
      images_pushed: pushedImages.length,
    };
  });
}

// ─── op: unpublish_profile ──────────────────────────────────────────

function op_unpublish_profile(body) {
  const profileId = String(body.profile_id ?? "").trim();
  if (!profileId) throw apiError_("VALIDATION_FAILED", "profile_id required");

  return withProfileLock_(profileId, 30000, () => {
    const profilesSheet = getDb_().getSheetByName("Groom Profiles");
    const { headers: profilesHeaders, rows: profiles } = readSheet_("Groom Profiles");
    const profile = profiles.find((p) => p.profile_id === profileId);
    if (!profile) throw apiError_("NOT_FOUND", `profile '${profileId}' not found`);
    if (profile.status !== "Published") {
      throw apiError_("VALIDATION_FAILED", "Profile is not currently Published");
    }

    const breed = findBreed_(profile.breed_id);

    // If this profile is the only Published one for this breed, remove the
    // breed JSON entirely. Otherwise rebuild it without this profile.
    const otherPublished = profiles.filter((p) =>
      p.breed_id === breed.breed_id && p.profile_id !== profileId && p.status === "Published");

    if (otherPublished.length === 0) {
      ghDeleteFile_(`public/breeds/${breed.slug}.json`, `Unpublish ${breed.breed_name}`);
    } else {
      // Rebuild with remaining published profiles.
      const remaining = otherPublished[0];
      const pack = buildBreedPack_(breed, remaining, Number(remaining.current_version ?? 1));
      ghPutFile_(`public/breeds/${breed.slug}.json`, JSON.stringify(pack, null, 2),
        `Unpublish ${breed.breed_name} / ${profile.groom_type}`);
    }

    writeRow_(profilesSheet, profilesHeaders, profile._rowIndex, {
      status: "Draft",
      published_version: "",
      published_pack_url: "",
      published_date: "",
      updated_at: nowIso_(),
    });

    enqueueSessionPackRebuildIfBooked_(breed.breed_id);
    return { profile_id: profileId, status: "Draft" };
  });
}

// ─── Validation ─────────────────────────────────────────────────────

function validatePublishable_(profile, breed) {
  const errors = [];

  if (!VALID_GROOM_TYPES.includes(profile.groom_type)) {
    errors.push(`groom_type '${profile.groom_type}' not in vocabulary`);
  }
  if (!breed.slug) errors.push("breed slug missing");

  // All five core sections present + non-empty text
  const { rows: sections } = readSheet_("Groom Knowledge");
  const profileSections = sections.filter((s) => s.profile_id === profile.profile_id);
  const sectionsByName = Object.fromEntries(profileSections.map((s) => [s.section_name, s]));
  for (const core of CORE_SECTIONS) {
    const sec = sectionsByName[core];
    if (!sec) {
      errors.push(`missing section "${core}"`);
    } else if (!String(sec.section_text ?? "").trim()) {
      errors.push(`section "${core}" is empty`);
    }
  }

  // At least one image with role=main, with valid crop bounds within its page.
  const { rows: images } = readSheet_("Images");
  const profileImages = images.filter((i) => i.profile_id === profile.profile_id);
  const mainImage = profileImages.find((i) => i.image_role === "main");
  if (!mainImage) {
    errors.push("no main image set");
  } else if (mainImage.source_page_render_id) {
    const { rows: renders } = readSheet_("Page Renders");
    const render = renders.find((r) => r.page_render_id === mainImage.source_page_render_id);
    if (render) {
      const x = Number(mainImage.crop_x ?? 0), y = Number(mainImage.crop_y ?? 0);
      const w = Number(mainImage.crop_w ?? 0), h = Number(mainImage.crop_h ?? 0);
      const W = Number(render.width_px ?? 0), H = Number(render.height_px ?? 0);
      if (W > 0 && H > 0 && (x + w > W || y + h > H || w <= 0 || h <= 0)) {
        errors.push(`main image crop out of page bounds`);
      }
    }
  }

  return errors;
}

// ─── Build the per-breed pack JSON ──────────────────────────────────

function buildBreedPack_(breed, primaryProfile, primaryCandidateVersion) {
  const allProfiles = readSheet_("Groom Profiles").rows.filter((p) =>
    p.breed_id === breed.breed_id && p.status === "Published" && p.profile_id !== primaryProfile.profile_id);

  const profilesPart = {};
  // Add the about-to-be-published profile first.
  profilesPart[primaryProfile.profile_id] = buildProfileForPack_(primaryProfile, breed, primaryCandidateVersion);
  for (const other of allProfiles) {
    profilesPart[other.profile_id] = buildProfileForPack_(other, breed, Number(other.current_version ?? 1));
  }

  const defaultProfile =
    Object.values(profilesPart).find((p) => p.groom_type === "Pet Groom")
    ?? Object.values(profilesPart).find((p) => p.is_default)
    ?? Object.values(profilesPart)[0];

  return {
    schema_version: 1,
    generated_at: nowIso_(),
    breed_id: breed.breed_id,
    breed_name: breed.breed_name,
    breed_slug: breed.slug,
    breed_type: breed.breed_type,
    parent_breed_ids: parseJsonArray_(breed.parent_breeds),
    default_profile_id: defaultProfile?.profile_id ?? null,
    profiles: profilesPart,
  };
}

function buildProfileForPack_(profile, breed, version) {
  const { rows: sections } = readSheet_("Groom Knowledge");
  const profileSections = sections
    .filter((s) => s.profile_id === profile.profile_id)
    .map((s) => ({
      section_id: s.section_id,
      name: s.section_name,
      order: Number(s.section_order ?? 0),
      text: s.section_text ?? "",
      blade_numbers: parseJsonArray_(s.blade_numbers),
    }))
    .sort((a, b) => a.order - b.order);

  const { rows: images } = readSheet_("Images");
  const profileImages = images.filter((i) => i.profile_id === profile.profile_id);
  const mainImage = profileImages.find((i) => i.image_role === "main");
  const supplementary = profileImages
    .filter((i) => i.image_role !== "main")
    .map((i) => ({
      image_id: i.image_id,
      role: i.image_role,
      url: imagePublicUrl_(breed.slug, profile.profile_id, i.image_id),
      width_px: Number(i.crop_w ?? 0),
      height_px: Number(i.crop_h ?? 0),
    }));

  const { rows: settings } = readSheet_("Display Settings");
  const setting = settings.find((s) => s.profile_id === profile.profile_id) ?? {};

  const blade_numbers = profileSections.flatMap((s) => s.blade_numbers).filter((b, i, a) => a.indexOf(b) === i);
  const importantNotes = sections
    .filter((s) => s.profile_id === profile.profile_id && s.important_notes)
    .map((s) => `[${s.section_name}] ${s.important_notes}`)
    .join("\n\n");

  return {
    profile_id: profile.profile_id,
    groom_type: profile.groom_type,
    groom_type_slug: slugify_(profile.groom_type),
    version,
    published_at: nowIso_(),
    blade_numbers,
    important_notes: importantNotes,
    is_default: profile.default_profile === true || profile.default_profile === "TRUE",
    sections: profileSections.map(({ section_id, name, order, text, blade_numbers }) =>
      ({ section_id, name, order, text, blade_numbers })),
    images: {
      main: mainImage ? {
        image_id: mainImage.image_id,
        url: imagePublicUrl_(breed.slug, profile.profile_id, mainImage.image_id),
        width_px: Number(mainImage.crop_w ?? 0),
        height_px: Number(mainImage.crop_h ?? 0),
      } : null,
      supplementary,
    },
    display: {
      image_panel_width: Number(setting.image_panel_width ?? 75),
      text_panel_width: Number(setting.text_panel_width ?? 25),
      font_size: setting.font_size ?? "medium",
      show_blade_box: setting.show_blade_box === false || setting.show_blade_box === "FALSE" ? false : true,
      show_warnings: setting.show_warnings === false || setting.show_warnings === "FALSE" ? false : true,
      theme: setting.theme ?? "default",
    },
  };
}

function imagePublicUrl_(breedSlug, profileId, imageId) {
  const owner = PropertiesService.getScriptProperties().getProperty("GITHUB_OWNER");
  const repo  = PropertiesService.getScriptProperties().getProperty("GITHUB_REPO");
  return `https://${owner}.github.io/${repo}/public/images/${breedSlug}/${profileId}/${imageId}.jpg`;
}

// ─── Drive staging + GitHub image push ──────────────────────────────

function stageToDrive_(profile, breedPack, version) {
  const driveRootId = PropertiesService.getScriptProperties().getProperty("DRIVE_ROOT_ID");
  if (!driveRootId) return;
  const root = DriveApp.getFolderById(driveRootId);

  const breedSlug = breedPack.breed_slug;
  const breedFolderName = `${breedSlug}__${breedPack.breed_id}`;
  const breedFolder = ensureSubfolder_(root, breedFolderName);
  const groomFolder = ensureSubfolder_(breedFolder, `${slugify_(profile.groom_type)}__${profile.profile_id}`);

  const approvedFolder = ensureSubfolder_(groomFolder, "05-approved-output");
  const versionFolder = ensureSubfolder_(groomFolder, "06-version-history");

  const filename = `${profile.profile_id}__published__v${version}.json`;
  const json = JSON.stringify(breedPack, null, 2);

  approvedFolder.createFile(filename, json, MimeType.PLAIN_TEXT).setName(filename);
  versionFolder.createFile(`${profile.profile_id}__v${version}__${stamp_()}.json`, json, MimeType.PLAIN_TEXT);
}

function ensureSubfolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parent.createFolder(name);
}

function stamp_() {
  return Utilities.formatDate(new Date(), "Etc/UTC", "yyyyMMddHHmm");
}

function publishImagesToGitHub_(breed, breedPack) {
  // Walk every image in every profile of the pack and PUT it to GitHub.
  // Idempotent — a PUT replaces if the file already exists.
  const pushed = [];
  for (const profile of Object.values(breedPack.profiles)) {
    if (!profile.images) continue;
    const all = [profile.images.main, ...(profile.images.supplementary ?? [])].filter(Boolean);
    for (const img of all) {
      const blob = readImageBlob_(img.image_id);
      if (!blob) continue;
      const path = `public/images/${breed.slug}/${profile.profile_id}/${img.image_id}.jpg`;
      ghPutFile_(path, blob.getBytes(), `Image ${img.image_id} for ${breed.breed_name} / ${profile.groom_type}`);
      pushed.push(path);
    }
  }
  return pushed;
}

function readImageBlob_(imageId) {
  const { rows: images } = readSheet_("Images");
  const row = images.find((i) => i.image_id === imageId);
  if (!row || !row.drive_file_id) return null;
  try {
    return DriveApp.getFileById(row.drive_file_id).getBlob();
  } catch (err) {
    Logger.log(`[publish] could not read image ${imageId}: ${err}`);
    return null;
  }
}

// ─── Session pack rebuild stub ──────────────────────────────────────

function enqueueSessionPackRebuildIfBooked_(breedId) {
  // For Stage 2 this is a no-op. When WF-01 is wired we'll fire its webhook
  // whenever a breed in today/tomorrow's bookings becomes Published.
  // For now we just record the intent in Operational Alerts so it's auditable.
  try {
    const sheet = getDb_().getSheetByName("Operational Alerts");
    if (!sheet) return;
    const headers = readSheet_("Operational Alerts").headers;
    appendRow_(sheet, headers, {
      alert_id: nextId_("alert"),
      severity: "info",
      source: "publish",
      message: `Session pack rebuild enqueued for breed ${breedId}`,
      payload_json: JSON.stringify({ breed_id: breedId }),
      created_at: nowIso_(),
    });
  } catch (err) {
    Logger.log(`[publish] could not log alert: ${err}`);
  }
}
