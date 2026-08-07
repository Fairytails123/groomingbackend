/**
 * reference-library.gs — private, provenance-rich source catalogue.
 *
 * Catalogue records are stored as JSON in the configured private Drive root;
 * Sheets holds the searchable index and review counters. Imported OCR is never
 * treated as approved grooming guidance. A profile can only be created after
 * every editorial section and high-risk item is explicitly resolved.
 */

const REFERENCE_SCHEMA_VERSION = 1;
const REFERENCE_FOLDER_NAME = "00-reference-library";

/**
 * One-time/idempotent production initializer for the private reference sheets.
 * Kept authenticated because it changes the database schema. ensureSheets_ only
 * creates missing sheets/columns and preserves every existing row and column.
 */
function op_ensure_reference_catalog_schema() {
  ensureSheets_();
  const db = getDb_();
  const required = ["Reference Sources", "Reference Entries"];
  const sheets = {};
  for (const name of required) {
    const sheet = db.getSheetByName(name);
    if (!sheet) throw apiError_("INTERNAL", `Reference sheet was not created: ${name}`);
    const width = Math.max(1, sheet.getLastColumn());
    const headers = sheet.getRange(1, 1, 1, width).getValues()[0].map(String);
    const missing = SHEET_SCHEMAS[name].filter((header) => !headers.includes(header));
    if (missing.length) {
      throw apiError_("INTERNAL", `Reference sheet is missing columns: ${name}: ${missing.join(", ")}`);
    }
    sheets[name] = { rows: Math.max(0, sheet.getLastRow() - 1), columns: headers.length };
  }
  return { schema_version: REFERENCE_SCHEMA_VERSION, ready: true, sheets };
}

function op_reference_catalog_status() {
  const { rows } = readSheet_("Reference Entries");
  const counts = {};
  for (const row of rows) {
    const status = String(row.review_status || "needs_review");
    counts[status] = (counts[status] || 0) + 1;
  }
  return {
    total_entries: rows.length,
    review_status_counts: counts,
    ready_for_profile_creation: rows.filter((r) => r.review_status === "approved" && !r.profile_id).length,
    linked_profiles: rows.filter((r) => !!r.profile_id).length,
  };
}

function op_import_reference_entry(body) {
  const record = body.record;
  validateReferenceRecord_(record);

  const suppliedHash = String(record.record_sha256 || "").toLowerCase();
  const calculatedHash = referenceRecordSourceHash_(record);
  if (!suppliedHash || suppliedHash !== calculatedHash) {
    throw apiError_("VALIDATION_FAILED", "Reference record hash does not match its content");
  }

  return withScriptLock_(30000, () => {
    upsertReferenceSource_(record);
    const entriesRead = readSheet_("Reference Entries");
    const existing = entriesRead.rows.find((row) =>
      row.source_id === record.source.source_id && row.breed_slug === record.breed.slug);

    if (existing && existing.record_sha256 === suppliedHash) {
      readReferenceRecord_(existing.drive_file_id, existing.stored_record_sha256);
      return {
        reference_entry_id: existing.reference_entry_id,
        revision: Number(existing.revision || 1),
        unchanged: true,
      };
    }
    if (existing && body.expected_record_sha256
        && String(body.expected_record_sha256) !== String(existing.record_sha256)) {
      throw apiError_("CONFLICT", "Reference entry changed since it was loaded");
    }

    const file = writeReferenceRecordFile_(record, existing?.drive_file_id);
    const counters = referenceReviewCounters_(record);
    const now = nowIso_();
    const rowValue = {
      source_id: record.source.source_id,
      breed_name: record.breed.name,
      breed_slug: record.breed.slug,
      group_name: record.breed.group || "",
      source_status: record.source.source_status || "available",
      review_status: record.review?.status || "needs_review",
      record_sha256: suppliedHash,
      stored_record_sha256: referenceStoredFileHash_(file),
      drive_file_id: file.getId(),
      revision: existing ? Number(existing.revision || 1) + 1 : 1,
      high_risk_total: counters.highRiskTotal,
      high_risk_verified: counters.highRiskVerified,
      sections_total: counters.sectionsTotal,
      sections_approved: counters.sectionsApproved,
      profile_id: existing?.profile_id || "",
      imported_at: existing?.imported_at || now,
      updated_at: now,
    };

    const sheet = getDb_().getSheetByName("Reference Entries");
    if (existing) {
      writeRow_(sheet, entriesRead.headers, existing._rowIndex, rowValue);
      return {
        reference_entry_id: existing.reference_entry_id,
        revision: rowValue.revision,
        unchanged: false,
      };
    }

    const referenceEntryId = nextId_("reference");
    appendRow_(sheet, entriesRead.headers, {
      reference_entry_id: referenceEntryId,
      ...rowValue,
    });
    return { reference_entry_id: referenceEntryId, revision: 1, unchanged: false };
  });
}

function op_search_reference_entries(body) {
  const query = String(body.query || "").trim().toLowerCase();
  const status = String(body.review_status || "").trim();
  const limit = Math.max(1, Math.min(250, Number(body.limit || 100)));
  const { rows } = readSheet_("Reference Entries");
  const entries = rows
    .filter((row) => !status || row.review_status === status)
    .filter((row) => !query || [row.breed_name, row.breed_slug, row.group_name]
      .join(" ").toLowerCase().includes(query))
    .sort((a, b) => String(a.breed_name).localeCompare(String(b.breed_name), "en"))
    .slice(0, limit)
    .map(referenceEntryView_);
  return { entries };
}

function op_import_reference_visual(body) {
  const result = importReferenceVisualsBatch_(body, [{
    asset_id: body.asset_id,
    variant: body.variant,
    data_url: body.data_url,
  }]);
  return result.items[0];
}

function op_import_reference_visuals_batch(body) {
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length || items.length > 20) {
    throw apiError_("VALIDATION_FAILED", "items must contain between 1 and 20 visual assets");
  }
  return importReferenceVisualsBatch_(body, items);
}

function importReferenceVisualsBatch_(body, rawItems) {
  const row = findReferenceEntry_(body);
  const requested = rawItems.map((item) => {
    const assetId = String(item.asset_id || "").trim();
    const variant = String(item.variant || "master").trim();
    const dataUrl = String(item.data_url || "");
    if (!assetId || !dataUrl) throw apiError_("VALIDATION_FAILED", "asset_id and data_url required");
    const match = dataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
    if (!match) throw apiError_("VALIDATION_FAILED", "Reference visual must be a base64 PNG data URL");
    return { assetId, variant, base64: match[1] };
  });

  return withScriptLock_(30000, () => {
    const fresh = findReferenceEntry_({ reference_entry_id: row.reference_entry_id });
    const record = readReferenceRecord_(fresh.drive_file_id, fresh.stored_record_sha256);
    const prepared = requested.map((item) => {
      const visual = record.visual_references.find((candidate) => candidate.asset_id === item.assetId);
      if (!visual) throw apiError_("NOT_FOUND", `Reference visual '${item.assetId}' not found`);
      const descriptor = referenceVisualVariant_(visual, item.variant);
      const bytes = Utilities.base64Decode(item.base64);
      const encodedHash = sha256ByteArrayHex_(bytes);
      if (encodedHash !== descriptor.expectedHash) {
        throw apiError_("VALIDATION_FAILED", `Uploaded ${item.variant} visual hash differs from its catalogue hash`);
      }
      return { ...item, visual, descriptor, bytes, encodedHash };
    });

    const sourceFolder = ensureSubfolder_(referenceRootFolder_(), record.source.source_id);
    const visualsFolder = ensureSubfolder_(sourceFolder, "visuals");
    const results = [];
    let changed = 0;
    for (const item of prepared) {
      if (item.descriptor.driveFileId) {
        try {
          const existing = DriveApp.getFileById(item.descriptor.driveFileId);
          if (sha256ByteArrayHex_(existing.getBlob().getBytes()) === item.encodedHash) {
            results.push({ asset_id: item.assetId, variant: item.variant,
              drive_file_id: existing.getId(), unchanged: true });
            continue;
          }
        } catch (error) {
          console.warn("[reference] existing visual unavailable; replacing", error);
        }
      }
      const filename = `${record.breed.slug}__${item.assetId}__${item.variant}.png`;
      const file = visualsFolder.createFile(Utilities.newBlob(item.bytes, "image/png", filename));
      if (item.variant === "master") {
        item.visual.drive_file_id = file.getId();
        item.visual.drive_encoded_sha256 = item.encodedHash;
        item.visual.import_status = "verified_private_master";
        item.visual.imported_at = nowIso_();
      } else {
        item.visual.enhanced_derivative.drive_file_id = file.getId();
        item.visual.enhanced_derivative.drive_encoded_sha256 = item.encodedHash;
        item.visual.enhanced_derivative.import_status = "verified_private_derivative";
        item.visual.enhanced_derivative.imported_at = nowIso_();
      }
      changed++;
      results.push({ asset_id: item.assetId, variant: item.variant,
        drive_file_id: file.getId(), unchanged: false });
    }
    if (!changed) return { items: results, imported: 0, unchanged: results.length,
      revision: Number(fresh.revision || 1) };

    record.review = record.review || {};
    record.review.review_revision_sha256 = referenceReviewHash_(record);
    const recordFile = writeReferenceRecordFile_(record, fresh.drive_file_id);

    const entriesRead = readSheet_("Reference Entries");
    const entry = entriesRead.rows.find((item) => item.reference_entry_id === fresh.reference_entry_id);
    const nextRevision = Number(entry.revision || 1) + 1;
    writeRow_(getDb_().getSheetByName("Reference Entries"), entriesRead.headers, entry._rowIndex, {
      revision: nextRevision,
      stored_record_sha256: referenceStoredFileHash_(recordFile),
      updated_at: nowIso_(),
    });
    return { items: results, imported: changed, unchanged: results.length - changed, revision: nextRevision };
  });
}

function op_get_reference_visual(body) {
  const row = findReferenceEntry_(body);
  const assetId = String(body.asset_id || "").trim();
  const variant = String(body.variant || "master").trim();
  if (!assetId) throw apiError_("VALIDATION_FAILED", "asset_id required");
  const record = readReferenceRecord_(row.drive_file_id, row.stored_record_sha256);
  const visual = record.visual_references.find((item) => item.asset_id === assetId);
  if (!visual) throw apiError_("NOT_FOUND", "Reference visual not found");
  const descriptor = referenceVisualVariant_(visual, variant);
  if (!descriptor.driveFileId) throw apiError_("NOT_FOUND", `Reference ${variant} visual has not been imported`);
  const blob = DriveApp.getFileById(descriptor.driveFileId).getBlob();
  const bytes = blob.getBytes();
  const encodedHash = sha256ByteArrayHex_(bytes);
  if (encodedHash !== descriptor.expectedHash) {
    throw apiError_("INTERNAL", "Stored reference visual failed its integrity check");
  }
  return {
    asset_id: assetId,
    variant,
    data_url: `data:image/png;base64,${Utilities.base64Encode(bytes)}`,
    encoded_sha256: encodedHash,
  };
}

function referenceVisualVariant_(visual, variant) {
  if (variant === "master") {
    if (!visual.browser_master_encoded_sha256) {
      throw apiError_("VALIDATION_FAILED", "Reference visual has no verified browser master");
    }
    return {
      expectedHash: String(visual.browser_master_encoded_sha256).toLowerCase(),
      driveFileId: visual.drive_file_id || "",
    };
  }
  if (variant === "enhanced") {
    const enhanced = visual.enhanced_derivative;
    if (!enhanced?.encoded_sha256) {
      throw apiError_("VALIDATION_FAILED", "This source page has no conservative enhanced derivative");
    }
    return {
      expectedHash: String(enhanced.encoded_sha256).toLowerCase(),
      driveFileId: enhanced.drive_file_id || "",
    };
  }
  throw apiError_("VALIDATION_FAILED", "variant must be 'master' or 'enhanced'");
}

function op_get_reference_entry(body) {
  const row = findReferenceEntry_(body);
  return { entry: referenceEntryView_(row), record: readReferenceRecord_(row.drive_file_id, row.stored_record_sha256) };
}

function op_save_reference_review(body) {
  const row = findReferenceEntry_(body);
  const expectedRevision = Number(body.expected_revision || 0);
  if (!expectedRevision) throw apiError_("VALIDATION_FAILED", "expected_revision required");

  return withScriptLock_(30000, () => {
    const fresh = findReferenceEntry_({ reference_entry_id: row.reference_entry_id });
    const currentRevision = Number(fresh.revision || 1);
    if (currentRevision !== expectedRevision) {
      throw apiError_("CONFLICT", `reference revision mismatch — expected ${expectedRevision}, got ${currentRevision}`);
    }

    const record = readReferenceRecord_(fresh.drive_file_id, fresh.stored_record_sha256);
    applyReferenceReviewPatch_(record, body.patch || {});
    const counters = referenceReviewCounters_(record);
    const approveRequested = body.approve === true;
    if (approveRequested && (counters.sectionsApproved !== counters.sectionsTotal
        || counters.highRiskVerified !== counters.highRiskTotal)) {
      throw apiError_("VALIDATION_FAILED", "All editorial sections and high-risk items must be resolved before approval");
    }
    record.review = record.review || {};
    record.review.status = approveRequested ? "approved" : "needs_review";
    record.review.high_risk_items_total = counters.highRiskTotal;
    record.review.high_risk_items_verified = counters.highRiskVerified;
    record.review.editorial_sections_total = counters.sectionsTotal;
    record.review.editorial_sections_approved = counters.sectionsApproved;
    record.review.updated_at = nowIso_();
    record.review.review_revision_sha256 = referenceReviewHash_(record);
    const recordFile = writeReferenceRecordFile_(record, fresh.drive_file_id);

    const entriesRead = readSheet_("Reference Entries");
    const freshRow = entriesRead.rows.find((item) => item.reference_entry_id === fresh.reference_entry_id);
    const nextRevision = currentRevision + 1;
    writeRow_(getDb_().getSheetByName("Reference Entries"), entriesRead.headers, freshRow._rowIndex, {
      review_status: record.review.status,
      stored_record_sha256: referenceStoredFileHash_(recordFile),
      revision: nextRevision,
      high_risk_total: counters.highRiskTotal,
      high_risk_verified: counters.highRiskVerified,
      sections_total: counters.sectionsTotal,
      sections_approved: counters.sectionsApproved,
      updated_at: nowIso_(),
    });
    return {
      reference_entry_id: fresh.reference_entry_id,
      revision: nextRevision,
      review_status: record.review.status,
      counters,
    };
  });
}

function op_create_profile_from_reference(body) {
  const row = findReferenceEntry_(body);
  if (row.profile_id) return { profile_id: row.profile_id, unchanged: true };
  if (row.review_status !== "approved") {
    throw apiError_("VALIDATION_FAILED", "Reference entry must be approved before creating a profile");
  }

  return withScriptLock_(30000, () => {
    const freshRow = findReferenceEntry_({ reference_entry_id: row.reference_entry_id });
    if (freshRow.profile_id) return { profile_id: freshRow.profile_id, unchanged: true };
    if (freshRow.review_status !== "approved") {
      throw apiError_("CONFLICT", "Reference approval changed before profile creation");
    }
    const record = readReferenceRecord_(freshRow.drive_file_id, freshRow.stored_record_sha256);
    const counters = referenceReviewCounters_(record);
    if (counters.sectionsTotal === 0 || counters.sectionsApproved !== counters.sectionsTotal
        || counters.highRiskVerified !== counters.highRiskTotal) {
      throw apiError_("VALIDATION_FAILED", "Reference entry is not fully resolved");
    }
    const breed = findOrCreateReferenceBreed_(record);
    const { rows: profiles } = readSheet_("Groom Profiles");
    const collision = profiles.find((profile) =>
      profile.breed_id === breed.breed_id && profile.groom_type === "Pet Groom" && profile.status !== "Archived");
    if (collision && collision.source_type !== "reference-catalog") {
      throw apiError_("CONFLICT", `${breed.breed_name} already has a Pet Groom profile; reference import will not overwrite it`);
    }

    const now = nowIso_();
    const profileId = collision?.profile_id || nextId_("profile");
    const recoveredPartialCreate = !!collision;
    if (!collision) {
      appendRow_(getDb_().getSheetByName("Groom Profiles"), readSheet_("Groom Profiles").headers, {
        profile_id: profileId,
        breed_id: breed.breed_id,
        breed_name: breed.breed_name,
        groom_type: "Pet Groom",
        source_type: "reference-catalog",
        source_pdf_drive_id: "",
        default_profile: "TRUE",
        status: "Needs Review",
        error_message: "",
        current_version: 1,
        created_at: now,
        updated_at: now,
      });
    }

    const sectionsSheet = getDb_().getSheetByName("Groom Knowledge");
    const sectionsRead = readSheet_("Groom Knowledge");
    const sectionsHeaders = sectionsRead.headers;
    const existingSectionNames = new Set(
      sectionsRead.rows.filter((section) => section.profile_id === profileId).map((section) => section.section_name)
    );
    for (const section of record.sections) {
      if (!section.approved || !String(section.editorial_text || "").trim()) continue;
      if (existingSectionNames.has(section.section_name)) continue;
      const pages = (section.source_pdf_pages || []).join(", ");
      appendRow_(sectionsSheet, sectionsHeaders, {
        section_id: nextId_("section"),
        profile_id: profileId,
        section_name: section.section_name,
        section_order: Number(section.section_order || 0),
        section_text: section.editorial_text,
        blade_numbers: JSON.stringify(verifiedReferenceBlades_(
          record,
          section.source_pdf_pages || [],
          section.section_key === "tools"
        )),
        important_notes: `Source: Notes from the Grooming Table; PDF page(s): ${pages}. Verify against the linked source visuals when applying pattern boundaries.`,
        ai_confidence: "",
        approved: "FALSE",
        created_at: now,
        updated_at: now,
      });
      existingSectionNames.add(section.section_name);
    }

    const displayRead = readSheet_("Display Settings");
    if (!displayRead.rows.some((setting) => setting.profile_id === profileId)) {
      appendRow_(getDb_().getSheetByName("Display Settings"), displayRead.headers, {
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
    }

    const entriesRead = readSheet_("Reference Entries");
    const entry = entriesRead.rows.find((item) => item.reference_entry_id === freshRow.reference_entry_id);
    writeRow_(getDb_().getSheetByName("Reference Entries"), entriesRead.headers, entry._rowIndex, {
      profile_id: profileId,
      updated_at: now,
    });
    return {
      profile_id: profileId,
      breed_id: breed.breed_id,
      unchanged: false,
      recovered_partial_create: recoveredPartialCreate,
    };
  });
}

function validateReferenceRecord_(record) {
  if (!record || typeof record !== "object") throw apiError_("VALIDATION_FAILED", "record required");
  if (Number(record.schema_version) !== REFERENCE_SCHEMA_VERSION) {
    throw apiError_("VALIDATION_FAILED", `Unsupported reference schema version '${record.schema_version}'`);
  }
  if (!record.source?.source_id || !record.source?.source_pdf_sha256) {
    throw apiError_("VALIDATION_FAILED", "record source identity and PDF hash required");
  }
  if (!record.breed?.name || !record.breed?.slug) {
    throw apiError_("VALIDATION_FAILED", "record breed name and slug required");
  }
  if (!Array.isArray(record.sections) || !Array.isArray(record.visual_references)
      || !Array.isArray(record.high_risk_review_queue)) {
    throw apiError_("VALIDATION_FAILED", "record sections, visual references, and review queue must be arrays");
  }
}

function upsertReferenceSource_(record) {
  const read = readSheet_("Reference Sources");
  const existing = read.rows.find((row) => row.source_id === record.source.source_id);
  if (existing && existing.source_pdf_sha256 !== record.source.source_pdf_sha256) {
    throw apiError_("CONFLICT", "A reference source with this ID has a different PDF hash");
  }
  const values = {
    title: record.source.title || record.source.source_id,
    source_pdf_sha256: record.source.source_pdf_sha256,
    schema_version: record.schema_version,
    rights_status: existing?.rights_status || "internal-reference-only",
    updated_at: nowIso_(),
  };
  const sheet = getDb_().getSheetByName("Reference Sources");
  if (existing) {
    writeRow_(sheet, read.headers, existing._rowIndex, values);
  } else {
    appendRow_(sheet, read.headers, {
      source_id: record.source.source_id,
      ...values,
      created_at: nowIso_(),
    });
  }
}

function referenceRootFolder_() {
  const rootId = PropertiesService.getScriptProperties().getProperty("DRIVE_ROOT_ID");
  if (!rootId) throw apiError_("INTERNAL", "DRIVE_ROOT_ID not configured");
  return ensureSubfolder_(DriveApp.getFolderById(rootId), REFERENCE_FOLDER_NAME);
}

function writeReferenceRecordFile_(record, existingFileId) {
  const content = JSON.stringify(record, null, 2);
  if (existingFileId) {
    try {
      const file = DriveApp.getFileById(existingFileId);
      file.setContent(content);
      return file;
    } catch (error) {
      console.warn("[reference] existing file unavailable; creating replacement", error);
    }
  }
  const sourceFolder = ensureSubfolder_(referenceRootFolder_(), record.source.source_id);
  return sourceFolder.createFile(`${record.breed.slug}.json`, content, MimeType.PLAIN_TEXT);
}

function readReferenceRecord_(fileId, expectedStoredHash) {
  if (!fileId) throw apiError_("INTERNAL", "Reference entry has no Drive file");
  try {
    const content = DriveApp.getFileById(fileId).getBlob().getDataAsString("UTF-8");
    if (expectedStoredHash && sha256Hex_(content) !== String(expectedStoredHash).toLowerCase()) {
      throw new Error("stored hash mismatch");
    }
    return JSON.parse(content);
  } catch (error) {
    throw apiError_("INTERNAL", "Reference record could not be read from Drive or failed its stored-content hash");
  }
}

function referenceStoredFileHash_(file) {
  return sha256Hex_(file.getBlob().getDataAsString("UTF-8"));
}

function findReferenceEntry_(body) {
  const id = String(body.reference_entry_id || "").trim();
  const slug = String(body.breed_slug || "").trim();
  if (!id && !slug) throw apiError_("VALIDATION_FAILED", "reference_entry_id or breed_slug required");
  const { rows } = readSheet_("Reference Entries");
  const row = rows.find((item) => id ? item.reference_entry_id === id : item.breed_slug === slug);
  if (!row) throw apiError_("NOT_FOUND", "Reference entry not found");
  return row;
}

function referenceEntryView_(row) {
  return {
    reference_entry_id: row.reference_entry_id,
    source_id: row.source_id,
    breed_name: row.breed_name,
    breed_slug: row.breed_slug,
    group_name: row.group_name,
    source_status: row.source_status,
    review_status: row.review_status,
    record_sha256: row.record_sha256,
    revision: Number(row.revision || 1),
    high_risk_total: Number(row.high_risk_total || 0),
    high_risk_verified: Number(row.high_risk_verified || 0),
    sections_total: Number(row.sections_total || 0),
    sections_approved: Number(row.sections_approved || 0),
    profile_id: row.profile_id || null,
    updated_at: toIso_(row.updated_at),
  };
}

function applyReferenceReviewPatch_(record, patch) {
  if (patch.facts && typeof patch.facts === "object") {
    for (const [key, update] of Object.entries(patch.facts)) {
      if (!record.facts?.[key] || !update || typeof update !== "object") continue;
      if (Object.prototype.hasOwnProperty.call(update, "verified_value")) record.facts[key].verified_value = update.verified_value;
      if (update.verification_status) record.facts[key].verification_status = update.verification_status;
      if (update.verification_source) record.facts[key].verification_source = update.verification_source;
    }
  }
  if (Array.isArray(patch.sections)) {
    const byKey = Object.fromEntries(record.sections.map((section) => [section.section_key, section]));
    for (const update of patch.sections) {
      const section = byKey[update.section_key];
      if (!section) continue;
      if (Object.prototype.hasOwnProperty.call(update, "editorial_text")) section.editorial_text = String(update.editorial_text || "");
      if (Object.prototype.hasOwnProperty.call(update, "approved")) section.approved = update.approved === true;
      section.verification_status = section.approved ? "editorially_verified" : "needs_editorial_review";
    }
  }
  if (Array.isArray(patch.high_risk_items)) {
    const byId = Object.fromEntries(record.high_risk_review_queue.map((item) => [item.review_id, item]));
    for (const update of patch.high_risk_items) {
      const item = byId[update.review_id];
      if (!item) continue;
      if (Object.prototype.hasOwnProperty.call(update, "verified_value")) item.verified_value = update.verified_value;
      if (update.verification_status) item.verification_status = update.verification_status;
      if (update.verification_source) item.verification_source = update.verification_source;
      if (Object.prototype.hasOwnProperty.call(update, "review_notes")) item.review_notes = String(update.review_notes || "");
    }
  }
}

function referenceReviewCounters_(record) {
  const sections = Array.isArray(record.sections) ? record.sections : [];
  const risks = Array.isArray(record.high_risk_review_queue) ? record.high_risk_review_queue : [];
  return {
    sectionsTotal: sections.length,
    sectionsApproved: sections.filter((section) => section.approved === true
      && !!String(section.editorial_text || "").trim()).length,
    highRiskTotal: risks.length,
    highRiskVerified: risks.filter((item) => isResolvedReferenceStatus_(item.verification_status)).length,
  };
}

function isResolvedReferenceStatus_(status) {
  return [
    "verified_from_source_image",
    "externally_verified",
    "externally_verified_product_reference",
    "not_applicable",
    "rejected_as_ocr_error",
  ].includes(String(status || ""));
}

function referenceRecordSourceHash_(record) {
  const clone = JSON.parse(JSON.stringify(record));
  delete clone.record_sha256;
  const canonical = JSON.stringify(sortReferenceValue_(clone));
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    canonical,
    Utilities.Charset.UTF_8,
  );
  return bytes.map((value) => (value < 0 ? value + 256 : value).toString(16).padStart(2, "0")).join("");
}

function referenceReviewHash_(record) {
  return sha256Hex_(JSON.stringify(sortReferenceValue_({
    facts: record.facts,
    sections: record.sections,
    high_risk_review_queue: record.high_risk_review_queue,
    review: { ...record.review, review_revision_sha256: undefined },
  })));
}

function sortReferenceValue_(value) {
  if (Array.isArray(value)) return value.map(sortReferenceValue_);
  if (value && typeof value === "object") {
    const sorted = {};
    Object.keys(value).sort().forEach((key) => {
      if (value[key] !== undefined) sorted[key] = sortReferenceValue_(value[key]);
    });
    return sorted;
  }
  return value;
}

function sha256ByteArrayHex_(bytes) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)
    .map((value) => (value < 0 ? value + 256 : value).toString(16).padStart(2, "0"))
    .join("");
}

function verifiedReferenceBlades_(record, sourcePages, includeExternal = true) {
  const blades = [];
  const pageFilter = Array.isArray(sourcePages)
    ? new Set(sourcePages.map((page) => Number(page)).filter(Boolean))
    : null;
  for (const item of record.high_risk_review_queue || []) {
    if (item.kind !== "blade_specification" || !isResolvedReferenceStatus_(item.verification_status)) continue;
    if (pageFilter && !pageFilter.has(Number(item.source_pdf_page))) continue;
    const values = Array.isArray(item.verified_value) ? item.verified_value : [item.verified_value];
    for (const value of values) {
      const blade = String(value || "").trim();
      if (blade && !blades.includes(blade)) blades.push(blade);
    }
  }
  for (const supplement of includeExternal ? (record.external_supplements || []) : []) {
    for (const spec of supplement.blade_specifications || []) {
      if (!isResolvedReferenceStatus_(spec.verification_status)) continue;
      for (const value of (Array.isArray(spec.value) ? spec.value : [spec.value])) {
        const blade = String(value || "").trim();
        if (blade && !blades.includes(blade)) blades.push(blade);
      }
    }
  }
  return blades;
}

function findOrCreateReferenceBreed_(record) {
  const read = readSheet_("Breeds");
  const existing = read.rows.find((breed) =>
    String(breed.breed_name || "").toLowerCase() === record.breed.name.toLowerCase());
  if (existing) return existing;
  const breedId = nextId_("breed");
  const slug = uniqueBreedSlug_(record.breed.name, breedId, new Set(read.rows.map((row) => row.slug).filter(Boolean)));
  const row = {
    breed_id: breedId,
    breed_name: record.breed.name,
    slug,
    breed_type: "pure",
    parent_breeds: "[]",
    alternative_names: "[]",
    common_jotform_names: "[]",
    notes: `Imported from ${record.source.title}; source PDF SHA-256 ${record.source.source_pdf_sha256}`,
    status: "active",
    created_date: nowIso_(),
    last_updated: nowIso_(),
  };
  appendRow_(getDb_().getSheetByName("Breeds"), read.headers, row);
  return row;
}
