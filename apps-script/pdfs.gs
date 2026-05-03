/**
 * pdfs.gs — Stage 3 Phase 2 PDF intake ops.
 *
 * Browser-orchestrated path: the admin website renders pages with pdf.js,
 * uploads each via op_save_page_render, and bookends the AI extraction
 * sequence with op_upload_pdf (entry) and op_finalize_pdf_intake (exit).
 *
 * op_get_source_pdf serves the stored PDF back so a re-extract from the
 * profile editor can re-run the same in-browser pipeline against the same
 * source bytes.
 *
 * op_finalize_pdf_intake lands in commit 5 alongside the vision-pass op.
 */

// ─── op: upload_pdf ─────────────────────────────────────────────────
//
// Browser POSTs the source PDF as base64. We save to Drive 01-original-pdf/
// (private — not publicly served), record source_pdf_drive_id on the profile,
// and flip status to Processing so the intake is recoverable if the tab dies
// mid-render.

function op_upload_pdf(body) {
  const profileId = requireString_(body.profile_id, "profile_id");
  const blobB64 = requireString_(body.pdf_blob_b64, "pdf_blob_b64", { maxLength: 200 * 1024 * 1024 });
  const originalFilename = requireString_(body.original_filename, "original_filename", { maxLength: 200 });

  return withProfileLock_(profileId, 30000, () => {
    const { rows: profiles } = readSheet_("Groom Profiles");
    const profile = profiles.find((p) => p.profile_id === profileId);
    if (!profile) throw apiError_("NOT_FOUND", `profile '${profileId}' not found`);
    const breed = findBreed_(profile.breed_id);

    const driveRootId = PropertiesService.getScriptProperties().getProperty("DRIVE_ROOT_ID");
    if (!driveRootId) throw apiError_("INTERNAL", "DRIVE_ROOT_ID not configured");
    const root = DriveApp.getFolderById(driveRootId);
    const breedFolder = ensureSubfolder_(root, `${breed.slug}__${breed.breed_id}`);
    const profileFolder = ensureSubfolder_(breedFolder, `${slugify_(profile.groom_type)}__${profile.profile_id}`);
    const pdfFolder = ensureSubfolder_(profileFolder, "01-original-pdf");

    const cleanB64 = String(blobB64).replace(/^data:[^,]+,/, "");
    const bytes = Utilities.base64Decode(cleanB64);
    const filename = `${profile.profile_id}__source__${stamp_()}.pdf`;
    const blob = Utilities.newBlob(bytes, "application/pdf", filename);
    const file = pdfFolder.createFile(blob);
    // PDFs stay private — only crops + page renders get publicly-served URLs
    // for the snipping CDN. Source PDFs are only ever fetched via Apps Script.

    const profilesSheet = getDb_().getSheetByName("Groom Profiles");
    const profilesHeaders = readSheet_("Groom Profiles").headers;
    writeRow_(profilesSheet, profilesHeaders, profile._rowIndex, {
      source_pdf_drive_id: file.getId(),
      source_type: "pdf",
      status: "Processing",
      error_message: "",
      updated_at: nowIso_(),
    });

    return {
      profile_id: profileId,
      drive_file_id: file.getId(),
      original_filename: originalFilename,
      status: "Processing",
    };
  });
}

// ─── op: get_source_pdf ─────────────────────────────────────────────
//
// Read the stored PDF back as base64 so the profile editor's "Re-extract"
// flow can re-run the in-browser pipeline against the same source.

function op_get_source_pdf(body) {
  const profileId = requireString_(body.profile_id, "profile_id");
  const { rows: profiles } = readSheet_("Groom Profiles");
  const profile = profiles.find((p) => p.profile_id === profileId);
  if (!profile) throw apiError_("NOT_FOUND", `profile '${profileId}' not found`);

  const driveId = profile.source_pdf_drive_id;
  if (!driveId) throw apiError_("NOT_FOUND", "no source PDF for this profile — upload one first");

  const file = DriveApp.getFileById(driveId);
  const blob = file.getBlob();
  const b64 = Utilities.base64Encode(blob.getBytes());
  return {
    profile_id: profileId,
    drive_file_id: driveId,
    original_filename: file.getName(),
    pdf_blob_b64: b64,
  };
}

// ─── op: finalize_pdf_intake ────────────────────────────────────────
//
// Called by the browser orchestrator once page renders + extraction +
// per-page vision are all done. Flips status Processing → Needs Review.
// `partial_failures` is informational — vision pages that errored don't
// block finalisation; we just record the count in error_message and log
// a warning alert.

function op_finalize_pdf_intake(body) {
  const profileId = requireString_(body.profile_id, "profile_id");
  const partialFailures = Array.isArray(body.partial_failures) ? body.partial_failures : [];

  return withProfileLock_(profileId, 30000, () => {
    const profilesSheet = getDb_().getSheetByName("Groom Profiles");
    const { headers, rows } = readSheet_("Groom Profiles");
    const profile = rows.find((p) => p.profile_id === profileId);
    if (!profile) throw apiError_("NOT_FOUND", `profile '${profileId}' not found`);
    if (profile.status !== "Processing") {
      throw apiError_("CONFLICT", `profile is in status '${profile.status}', expected 'Processing'`);
    }

    const errMsg = partialFailures.length
      ? `Vision pass skipped on ${partialFailures.length} page(s)`
      : "";
    writeRow_(profilesSheet, headers, profile._rowIndex, {
      status: "Needs Review",
      error_message: errMsg,
      updated_at: nowIso_(),
    });

    if (partialFailures.length) {
      logOperationalAlert_("warning", "vision_pass", errMsg, {
        profile_id: profileId,
        partial_failures: partialFailures,
      });
    }

    return {
      profile_id: profileId,
      status: "Needs Review",
      partial_failure_count: partialFailures.length,
    };
  });
}
