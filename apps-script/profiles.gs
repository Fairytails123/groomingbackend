/**
 * profiles.gs — profile + sections + display CRUD.
 *
 * The five core sections per profile (spec §7 Sheet 3):
 *   Body, Throat and chest, Carriage and tail end, Legs and feet, Head/ears/brows
 *
 * Concurrency: every mutating op acquires withProfileLock_ AND checks
 * expected_version against the current Groom Profiles row.
 */

const CORE_SECTIONS = [
  "Body",
  "Throat and chest",
  "Carriage and tail end",
  "Legs and feet",
  "Head/ears/brows",
];

const PROFILE_STATUSES = ["Draft", "Processing", "Needs Review", "Published", "Archived", "Failed"];

// ─── op: get_breed_profile ──────────────────────────────────────────

function op_get_breed_profile(body) {
  const profileId = String(body.profile_id ?? "").trim();
  const breedId = String(body.breed_id ?? "").trim();
  if (!profileId && !breedId) {
    throw apiError_("VALIDATION_FAILED", "profile_id or breed_id required");
  }

  const { rows: profiles } = readSheet_("Groom Profiles");

  let profile;
  if (profileId) {
    profile = profiles.find((p) => p.profile_id === profileId);
    if (!profile) throw apiError_("NOT_FOUND", `profile '${profileId}' not found`);
  } else {
    // breed_id given — pick the default Pet Groom or the first non-archived
    const candidates = profiles.filter((p) => p.breed_id === breedId && p.status !== "Archived");
    if (candidates.length === 0) {
      // No profiles yet — return the breed alone so the editor can create one.
      const breed = findBreed_(breedId);
      return shellProfileForBreed_(breed);
    }
    const petGroom = candidates.find((p) => p.groom_type === "Pet Groom" && p.status === "Published");
    const defaultMarked = candidates.find((p) => p.default_profile === true || p.default_profile === "TRUE");
    profile = petGroom ?? defaultMarked ?? candidates.sort((a, b) => String(a.groom_type).localeCompare(String(b.groom_type)))[0];
  }

  const breed = findBreed_(profile.breed_id);

  // Sections
  const { rows: sections } = readSheet_("Groom Knowledge");
  const profileSections = sections
    .filter((s) => s.profile_id === profile.profile_id)
    .map((s) => ({
      section_id: s.section_id,
      section_name: s.section_name,
      section_order: Number(s.section_order ?? 0),
      section_text: s.section_text ?? "",
      blade_numbers: parseJsonArray_(s.blade_numbers),
      important_notes: s.important_notes ?? "",
      ai_confidence: s.ai_confidence === "" || s.ai_confidence == null ? null : Number(s.ai_confidence),
      approved: s.approved === true || s.approved === "TRUE",
    }))
    .sort((a, b) => a.section_order - b.section_order);

  // Images
  const { rows: images } = readSheet_("Images");
  const profileImages = images
    .filter((i) => i.profile_id === profile.profile_id)
    .map((i) => ({
      image_id: i.image_id,
      image_role: i.image_role,
      source_page_render_id: i.source_page_render_id,
      crop_x: Number(i.crop_x ?? 0),
      crop_y: Number(i.crop_y ?? 0),
      crop_w: Number(i.crop_w ?? 0),
      crop_h: Number(i.crop_h ?? 0),
      drive_file_id: i.drive_file_id,
      display_position: Number(i.display_position ?? 0),
      approved: i.approved === true || i.approved === "TRUE",
      last_recropped_date: toIso_(i.last_recropped_date),
    }))
    .sort((a, b) => a.display_position - b.display_position);

  // Page renders
  const { rows: renders } = readSheet_("Page Renders");
  const profileRenders = renders
    .filter((r) => r.profile_id === profile.profile_id)
    .map((r) => ({
      page_render_id: r.page_render_id,
      page_index: Number(r.page_index ?? 0),
      drive_file_id: r.drive_file_id,
      width_px: Number(r.width_px ?? 0),
      height_px: Number(r.height_px ?? 0),
      url: imageProxyUrl_(r.drive_file_id),
    }))
    .sort((a, b) => a.page_index - b.page_index);

  // Display settings
  const { rows: settings } = readSheet_("Display Settings");
  const setting = settings.find((s) => s.profile_id === profile.profile_id) ?? {};

  return {
    profile: {
      profile_id: profile.profile_id,
      breed_id: profile.breed_id,
      breed_name: profile.breed_name,
      groom_type: profile.groom_type,
      source_type: profile.source_type ?? "manual",
      source_pdf_drive_id: profile.source_pdf_drive_id ?? null,
      default_profile: profile.default_profile === true || profile.default_profile === "TRUE",
      status: profile.status,
      error_message: profile.error_message ?? null,
      current_version: Number(profile.current_version ?? 1),
      published_version: profile.published_version ? Number(profile.published_version) : null,
      published_pack_url: profile.published_pack_url ?? null,
      last_publish_attempt_at: toIso_(profile.last_publish_attempt_at),
      last_publish_succeeded_at: toIso_(profile.last_publish_succeeded_at),
      approved_date: toIso_(profile.approved_date),
      published_date: toIso_(profile.published_date),
      created_at: toIso_(profile.created_at),
      updated_at: toIso_(profile.updated_at),
    },
    breed: breedToView_(breed),
    sections: profileSections,
    images: profileImages,
    page_renders: profileRenders,
    display_settings: {
      image_panel_width: Number(setting.image_panel_width ?? 75),
      text_panel_width: Number(setting.text_panel_width ?? 25),
      main_image_id: setting.main_image_id ?? null,
      supplementary_order: parseJsonArray_(setting.supplementary_order),
      font_size: setting.font_size ?? "medium",
      show_blade_box: setting.show_blade_box === false || setting.show_blade_box === "FALSE" ? false : true,
      show_warnings: setting.show_warnings === false || setting.show_warnings === "FALSE" ? false : true,
      theme: setting.theme ?? "default",
    },
  };
}

function shellProfileForBreed_(breed) {
  return {
    profile: null,
    breed: breedToView_(breed),
    sections: [],
    images: [],
    page_renders: [],
    display_settings: defaultDisplaySettings_(),
  };
}

function defaultDisplaySettings_() {
  return {
    image_panel_width: 75,
    text_panel_width: 25,
    main_image_id: null,
    supplementary_order: [],
    font_size: "medium",
    show_blade_box: true,
    show_warnings: true,
    theme: "default",
  };
}

function findBreed_(breedId) {
  const { rows: breeds } = readSheet_("Breeds");
  const breed = breeds.find((b) => b.breed_id === breedId);
  if (!breed) throw apiError_("NOT_FOUND", `breed '${breedId}' not found`);
  return breed;
}

function breedToView_(b) {
  return {
    breed_id: b.breed_id,
    breed_name: b.breed_name,
    slug: b.slug,
    breed_type: b.breed_type,
    parent_breeds: parseJsonArray_(b.parent_breeds),
    alternative_names: parseJsonArray_(b.alternative_names),
    common_jotform_names: parseJsonArray_(b.common_jotform_names),
    notes: b.notes ?? "",
  };
}

function imageProxyUrl_(driveFileId) {
  if (!driveFileId) return null;
  // The image proxy is the same Apps Script Web App's doGet endpoint.
  // ScriptApp.getService().getUrl() returns the deployment URL when a Web App is published.
  const baseUrl = ScriptApp.getService().getUrl();
  return `${baseUrl}?id=${encodeURIComponent(driveFileId)}`;
}

// ─── op: list_groom_types ───────────────────────────────────────────

function op_list_groom_types(body) {
  const breedId = body.breed_id ? String(body.breed_id) : null;
  const { rows: profiles } = readSheet_("Groom Profiles");

  // Always-allowed canonical types — Pet Groom is reserved as the default baseline.
  const baseTypes = ["Pet Groom", "Show", "Sporting", "Puppy", "Maintenance", "Hand Strip"];

  const counts = {};
  for (const p of profiles) {
    if (breedId && p.breed_id !== breedId) continue;
    const t = p.groom_type;
    if (!t) continue;
    if (!counts[t]) counts[t] = { name: t, slug: slugify_(t), profile_count: 0, published_count: 0 };
    if (p.status !== "Archived") counts[t].profile_count++;
    if (p.status === "Published") counts[t].published_count++;
  }

  // Merge in always-allowed types even with zero profiles.
  for (const t of baseTypes) {
    if (!counts[t]) counts[t] = { name: t, slug: slugify_(t), profile_count: 0, published_count: 0 };
  }

  const groomTypes = Object.values(counts).sort((a, b) => a.name.localeCompare(b.name));
  return { groom_types: groomTypes };
}

// ─── op: create_profile (new groom type for a breed) ────────────────

function op_create_profile(body) {
  const breedId = String(body.breed_id ?? "").trim();
  const groomType = String(body.groom_type ?? "").trim();
  if (!breedId) throw apiError_("VALIDATION_FAILED", "breed_id required");
  if (!groomType) throw apiError_("VALIDATION_FAILED", "groom_type required");

  const breed = findBreed_(breedId);

  return withScriptLock_(15000, () => {
    const { rows: profiles } = readSheet_("Groom Profiles");
    const existing = profiles.find((p) =>
      p.breed_id === breedId && p.groom_type === groomType && p.status !== "Archived");
    if (existing) {
      throw apiError_("VALIDATION_FAILED", `${breed.breed_name} already has a ${groomType} profile`);
    }

    const profileId = nextId_("profile");
    const sheet = getDb_().getSheetByName("Groom Profiles");
    appendRow_(sheet, readSheet_("Groom Profiles").headers, {
      profile_id: profileId,
      breed_id: breedId,
      breed_name: breed.breed_name,
      groom_type: groomType,
      source_type: body.source_type ?? "manual",
      source_pdf_drive_id: body.source_pdf_drive_id ?? "",
      default_profile: groomType === "Pet Groom" ? "TRUE" : "FALSE",
      status: "Draft",
      error_message: "",
      current_version: 1,
      published_version: "",
      published_pack_url: "",
      last_publish_attempt_at: "",
      last_publish_succeeded_at: "",
      approved_date: "",
      published_date: "",
      created_at: nowIso_(),
      updated_at: nowIso_(),
    });

    // Seed core sections empty so the editor has something to render.
    const sectionsSheet = getDb_().getSheetByName("Groom Knowledge");
    const sectionsHeaders = readSheet_("Groom Knowledge").headers;
    CORE_SECTIONS.forEach((name, idx) => {
      appendRow_(sectionsSheet, sectionsHeaders, {
        section_id: nextId_("section"),
        profile_id: profileId,
        section_name: name,
        section_order: idx + 1,
        section_text: "",
        blade_numbers: "[]",
        important_notes: "",
        ai_confidence: "",
        approved: "FALSE",
        created_at: nowIso_(),
        updated_at: nowIso_(),
      });
    });

    // Seed display settings
    const settingsSheet = getDb_().getSheetByName("Display Settings");
    const settingsHeaders = readSheet_("Display Settings").headers;
    appendRow_(settingsSheet, settingsHeaders, {
      profile_id: profileId,
      image_panel_width: 75,
      text_panel_width: 25,
      main_image_id: "",
      supplementary_order: "[]",
      font_size: "medium",
      show_blade_box: "TRUE",
      show_warnings: "TRUE",
      theme: "default",
    });

    return { profile_id: profileId };
  });
}

// ─── op: save_profile (atomic write of text/sections/blade-nos/display) ─

function op_save_profile(body) {
  const profileId = String(body.profile_id ?? "").trim();
  const expectedVersion = Number(body.expected_version ?? 0);
  const patch = body.patch ?? {};
  if (!profileId) throw apiError_("VALIDATION_FAILED", "profile_id required");

  return withProfileLock_(profileId, 30000, () => {
    const profilesSheet = getDb_().getSheetByName("Groom Profiles");
    const { headers: profilesHeaders, rows: profiles } = readSheet_("Groom Profiles");
    const profile = profiles.find((p) => p.profile_id === profileId);
    if (!profile) throw apiError_("NOT_FOUND", `profile '${profileId}' not found`);

    const currentVersion = Number(profile.current_version ?? 1);
    if (expectedVersion && expectedVersion !== currentVersion) {
      throw apiError_("CONFLICT", `version mismatch — expected ${expectedVersion}, got ${currentVersion}`);
    }

    // Snapshot for version history before mutating.
    const snapshot = {
      sections: readSheet_("Groom Knowledge").rows.filter((s) => s.profile_id === profileId),
      display: readSheet_("Display Settings").rows.find((s) => s.profile_id === profileId),
      profile: { ...profile },
    };

    // Patch sections
    if (Array.isArray(patch.sections)) {
      const sectionsSheet = getDb_().getSheetByName("Groom Knowledge");
      const sectionsRead = readSheet_("Groom Knowledge");
      const existingByProfile = sectionsRead.rows.filter((s) => s.profile_id === profileId);
      const existingById = Object.fromEntries(existingByProfile.map((s) => [s.section_id, s]));
      const patchedIds = new Set();

      // Order incoming sections so section_order is unique
      const incoming = patch.sections.map((s, i) => ({ ...s, section_order: s.section_order ?? (i + 1) }));

      for (const sec of incoming) {
        const sectionName = String(sec.section_name ?? "").trim();
        if (!sectionName) continue;
        const sectionId = sec.section_id || null;

        if (sectionId && existingById[sectionId]) {
          // Update
          writeRow_(sectionsSheet, sectionsRead.headers, existingById[sectionId]._rowIndex, {
            section_name: sectionName,
            section_order: sec.section_order,
            section_text: sec.section_text ?? "",
            blade_numbers: JSON.stringify(sec.blade_numbers ?? []),
            important_notes: sec.important_notes ?? "",
            approved: sec.approved ? "TRUE" : "FALSE",
            updated_at: nowIso_(),
          });
          patchedIds.add(sectionId);
        } else {
          // Insert
          const newId = nextId_("section");
          appendRow_(sectionsSheet, sectionsRead.headers, {
            section_id: newId,
            profile_id: profileId,
            section_name: sectionName,
            section_order: sec.section_order,
            section_text: sec.section_text ?? "",
            blade_numbers: JSON.stringify(sec.blade_numbers ?? []),
            important_notes: sec.important_notes ?? "",
            ai_confidence: "",
            approved: sec.approved ? "TRUE" : "FALSE",
            created_at: nowIso_(),
            updated_at: nowIso_(),
          });
          patchedIds.add(newId);
        }
      }

      // Delete any existing section that wasn't included in the patch
      // (delete bottom-up to preserve row indices).
      const toDelete = existingByProfile.filter((s) => !patchedIds.has(s.section_id))
        .sort((a, b) => b._rowIndex - a._rowIndex);
      for (const s of toDelete) {
        sectionsSheet.deleteRow(s._rowIndex);
      }
    }

    // Patch display settings
    if (patch.display_settings) {
      const settingsSheet = getDb_().getSheetByName("Display Settings");
      const settingsRead = readSheet_("Display Settings");
      const existing = settingsRead.rows.find((s) => s.profile_id === profileId);
      const ds = patch.display_settings;
      const settingsRow = {
        image_panel_width: Number(ds.image_panel_width ?? 75),
        text_panel_width: Number(ds.text_panel_width ?? 25),
        main_image_id: ds.main_image_id ?? "",
        supplementary_order: JSON.stringify(ds.supplementary_order ?? []),
        font_size: ds.font_size ?? "medium",
        show_blade_box: ds.show_blade_box === false ? "FALSE" : "TRUE",
        show_warnings: ds.show_warnings === false ? "FALSE" : "TRUE",
        theme: ds.theme ?? "default",
      };
      if (existing) {
        writeRow_(settingsSheet, settingsRead.headers, existing._rowIndex, settingsRow);
      } else {
        appendRow_(settingsSheet, settingsRead.headers, { profile_id: profileId, ...settingsRow });
      }
    }

    // Patch profile-level fields (groom_type, default_profile)
    const profilePatch = {
      current_version: currentVersion + 1,
      updated_at: nowIso_(),
    };
    if (patch.groom_type) profilePatch.groom_type = String(patch.groom_type);
    if (typeof patch.default_profile === "boolean") {
      profilePatch.default_profile = patch.default_profile ? "TRUE" : "FALSE";
      // Enforce one-default-per-breed
      if (patch.default_profile === true) {
        for (const p of profiles) {
          if (p.breed_id === profile.breed_id && p.profile_id !== profileId
              && (p.default_profile === true || p.default_profile === "TRUE")) {
            writeRow_(profilesSheet, profilesHeaders, p._rowIndex, { default_profile: "FALSE", updated_at: nowIso_() });
          }
        }
      }
    }
    // If status is Published and we just edited, transition to Draft (spec §4.5).
    if (profile.status === "Published") profilePatch.status = "Draft";

    writeRow_(profilesSheet, profilesHeaders, profile._rowIndex, profilePatch);

    // Append version history
    const historySheet = getDb_().getSheetByName("Version History");
    const historyHeaders = readSheet_("Version History").headers;
    appendRow_(historySheet, historyHeaders, {
      version_id: nextId_("version"),
      profile_id: profileId,
      change_type: "edit",
      previous_value: JSON.stringify({
        sections: snapshot.sections.map((s) => ({
          section_id: s.section_id, section_name: s.section_name, section_order: s.section_order,
          section_text: s.section_text, blade_numbers: parseJsonArray_(s.blade_numbers),
        })),
        display: snapshot.display,
      }),
      new_value: JSON.stringify(patch),
      actor: "kamal",
      reason: body.reason ?? "",
      created_at: nowIso_(),
    });

    return { profile_id: profileId, current_version: currentVersion + 1 };
  });
}

// ─── op: archive_profile + restore_profile ──────────────────────────

function op_archive_profile(body) {
  const profileId = String(body.profile_id ?? "").trim();
  if (!profileId) throw apiError_("VALIDATION_FAILED", "profile_id required");
  return withProfileLock_(profileId, 15000, () => {
    const sheet = getDb_().getSheetByName("Groom Profiles");
    const { headers, rows } = readSheet_("Groom Profiles");
    const profile = rows.find((p) => p.profile_id === profileId);
    if (!profile) throw apiError_("NOT_FOUND", `profile '${profileId}' not found`);
    writeRow_(sheet, headers, profile._rowIndex, { status: "Archived", updated_at: nowIso_() });
    return { profile_id: profileId, status: "Archived" };
  });
}

function op_restore_profile(body) {
  const profileId = String(body.profile_id ?? "").trim();
  if (!profileId) throw apiError_("VALIDATION_FAILED", "profile_id required");
  return withProfileLock_(profileId, 15000, () => {
    const sheet = getDb_().getSheetByName("Groom Profiles");
    const { headers, rows } = readSheet_("Groom Profiles");
    const profile = rows.find((p) => p.profile_id === profileId);
    if (!profile) throw apiError_("NOT_FOUND", `profile '${profileId}' not found`);
    if (profile.status !== "Archived") {
      throw apiError_("VALIDATION_FAILED", `profile is not archived`);
    }
    writeRow_(sheet, headers, profile._rowIndex, { status: "Draft", updated_at: nowIso_() });
    return { profile_id: profileId, status: "Draft" };
  });
}

// ─── op: duplicate_profile ──────────────────────────────────────────

function op_duplicate_profile(body) {
  const sourceProfileId = String(body.profile_id ?? "").trim();
  const newGroomType = String(body.new_groom_type ?? "").trim();
  if (!sourceProfileId) throw apiError_("VALIDATION_FAILED", "profile_id required");
  if (!newGroomType) throw apiError_("VALIDATION_FAILED", "new_groom_type required");

  return withScriptLock_(30000, () => {
    const profilesSheet = getDb_().getSheetByName("Groom Profiles");
    const { headers: pHeaders, rows: profiles } = readSheet_("Groom Profiles");
    const source = profiles.find((p) => p.profile_id === sourceProfileId);
    if (!source) throw apiError_("NOT_FOUND", `profile '${sourceProfileId}' not found`);

    const collision = profiles.find((p) =>
      p.breed_id === source.breed_id && p.groom_type === newGroomType && p.status !== "Archived");
    if (collision) {
      throw apiError_("VALIDATION_FAILED", `${source.breed_name} already has a ${newGroomType} profile`);
    }

    const newProfileId = nextId_("profile");
    appendRow_(profilesSheet, pHeaders, {
      profile_id: newProfileId,
      breed_id: source.breed_id,
      breed_name: source.breed_name,
      groom_type: newGroomType,
      source_type: source.source_type ?? "manual",
      source_pdf_drive_id: source.source_pdf_drive_id ?? "",
      default_profile: "FALSE",
      status: "Draft",
      error_message: "",
      current_version: 1,
      published_version: "",
      published_pack_url: "",
      last_publish_attempt_at: "",
      last_publish_succeeded_at: "",
      approved_date: "",
      published_date: "",
      created_at: nowIso_(),
      updated_at: nowIso_(),
    });

    // Copy sections (new section_ids, same content)
    const sectionsSheet = getDb_().getSheetByName("Groom Knowledge");
    const sectionsRead = readSheet_("Groom Knowledge");
    const sourceSections = sectionsRead.rows.filter((s) => s.profile_id === sourceProfileId);
    for (const s of sourceSections) {
      appendRow_(sectionsSheet, sectionsRead.headers, {
        section_id: nextId_("section"),
        profile_id: newProfileId,
        section_name: s.section_name,
        section_order: s.section_order,
        section_text: s.section_text,
        blade_numbers: s.blade_numbers,
        important_notes: s.important_notes,
        ai_confidence: "",
        approved: "FALSE",
        created_at: nowIso_(),
        updated_at: nowIso_(),
      });
    }

    // Copy display settings
    const settingsSheet = getDb_().getSheetByName("Display Settings");
    const settingsRead = readSheet_("Display Settings");
    const sourceSettings = settingsRead.rows.find((s) => s.profile_id === sourceProfileId);
    appendRow_(settingsSheet, settingsRead.headers, {
      profile_id: newProfileId,
      image_panel_width: sourceSettings?.image_panel_width ?? 75,
      text_panel_width:  sourceSettings?.text_panel_width  ?? 25,
      main_image_id: "",
      supplementary_order: "[]",
      font_size: sourceSettings?.font_size ?? "medium",
      show_blade_box: sourceSettings?.show_blade_box ?? "TRUE",
      show_warnings: sourceSettings?.show_warnings ?? "TRUE",
      theme: sourceSettings?.theme ?? "default",
    });

    // Note: images are NOT copied. Crops are profile-specific and the source-page-render references would dangle.
    return { profile_id: newProfileId };
  });
}
