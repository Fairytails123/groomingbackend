/**
 * crops.gs — page renders + crops, the snipping-tool back-end.
 *
 * Stage 3 Phase 1: client-side cropping. Browser exports the cropped JPEG via
 * canvas.toDataURL and POSTs the bytes here. Apps Script writes to Drive +
 * Images sheet. Coordinates also persisted so re-cropping later doesn't
 * require re-uploading the source page render.
 *
 * Stage 3 Phase 2 (later): server-side cropping via n8n WF-10 + Pillow for
 * byte-perfect re-encoding. The data model is identical — only the bytes
 * pipeline changes.
 */

// ─── op: list_page_renders ──────────────────────────────────────────

function op_list_page_renders(body) {
  const profileId = String(body.profile_id ?? "").trim();
  if (!profileId) throw apiError_("VALIDATION_FAILED", "profile_id required");
  const { rows } = readSheet_("Page Renders");
  const items = rows
    .filter((r) => r.profile_id === profileId && !r.deleted_at)
    .map((r) => ({
      page_render_id: r.page_render_id,
      page_index: Number(r.page_index ?? 0),
      drive_file_id: r.drive_file_id,
      width_px: Number(r.width_px ?? 0),
      height_px: Number(r.height_px ?? 0),
      url: imageProxyUrl_(r.drive_file_id),
    }))
    .sort((a, b) => a.page_index - b.page_index);
  return { page_renders: items };
}

// ─── op: save_page_render ───────────────────────────────────────────
//
// Manual page-render upload (until WF-07 pdftoppm renderer ships). The
// browser POSTs a base64 JPEG along with width_px/height_px from the
// browser's natural dimensions — Apps Script doesn't decode the image.

function op_save_page_render(body) {
  const profileId = String(body.profile_id ?? "").trim();
  const pageIndex = Number(body.page_index ?? 0);
  const widthPx = Number(body.width_px ?? 0);
  const heightPx = Number(body.height_px ?? 0);
  const blobB64 = body.jpeg_blob_b64 ?? "";

  if (!profileId) throw apiError_("VALIDATION_FAILED", "profile_id required");
  if (!pageIndex || pageIndex < 1) throw apiError_("VALIDATION_FAILED", "page_index required (1-based)");
  if (!widthPx || !heightPx) throw apiError_("VALIDATION_FAILED", "width_px and height_px required");
  if (!blobB64) throw apiError_("VALIDATION_FAILED", "jpeg_blob_b64 required");

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
    const pageFolder = ensureSubfolder_(profileFolder, "02-page-renders");

    const cleanB64 = String(blobB64).replace(/^data:[^,]+,/, "");
    const bytes = Utilities.base64Decode(cleanB64);
    const renderId = nextId_("page_render");
    const filename = `${profile.profile_id}__page-${String(pageIndex).padStart(2, "0")}__${renderId}.jpg`;
    const blob = Utilities.newBlob(bytes, "image/jpeg", filename);
    const file = pageFolder.createFile(blob);
    makeFilePublicForServing_(file);

    const sheet = getDb_().getSheetByName("Page Renders");
    appendRow_(sheet, readSheet_("Page Renders").headers, {
      page_render_id: renderId,
      profile_id: profileId,
      page_index: pageIndex,
      drive_file_id: file.getId(),
      width_px: widthPx,
      height_px: heightPx,
      dpi: 300,
      created_at: nowIso_(),
    });

    return {
      page_render_id: renderId,
      drive_file_id: file.getId(),
      url: imageProxyUrl_(file.getId()),
      width_px: widthPx,
      height_px: heightPx,
    };
  });
}

// ─── op: save_crop ──────────────────────────────────────────────────

function op_save_crop(body) {
  const profileId = String(body.profile_id ?? "").trim();
  const role = String(body.image_role ?? "").trim();
  const pageRenderId = String(body.source_page_render_id ?? "").trim();
  const cropX = Number(body.crop_x ?? 0);
  const cropY = Number(body.crop_y ?? 0);
  const cropW = Number(body.crop_w ?? 0);
  const cropH = Number(body.crop_h ?? 0);
  const blobB64 = body.jpeg_blob_b64 ?? "";

  if (!profileId) throw apiError_("VALIDATION_FAILED", "profile_id required");
  if (!VALID_IMAGE_ROLES.includes(role)) {
    throw apiError_("VALIDATION_FAILED", `image_role must be one of ${VALID_IMAGE_ROLES.join(", ")}`);
  }
  if (!pageRenderId) throw apiError_("VALIDATION_FAILED", "source_page_render_id required");
  if (cropW <= 0 || cropH <= 0) throw apiError_("VALIDATION_FAILED", "crop dimensions must be positive");
  if (!blobB64) throw apiError_("VALIDATION_FAILED", "jpeg_blob_b64 required");

  return withProfileLock_(profileId, 30000, () => {
    const { rows: profiles } = readSheet_("Groom Profiles");
    const profile = profiles.find((p) => p.profile_id === profileId);
    if (!profile) throw apiError_("NOT_FOUND", `profile '${profileId}' not found`);
    const breed = findBreed_(profile.breed_id);

    // Validate the page render exists and crop fits within its bounds.
    const { rows: renders } = readSheet_("Page Renders");
    const render = renders.find((r) => r.page_render_id === pageRenderId);
    if (!render) throw apiError_("NOT_FOUND", `page render '${pageRenderId}' not found`);
    if (render.profile_id !== profileId) {
      throw apiError_("VALIDATION_FAILED", "page render does not belong to this profile");
    }
    const W = Number(render.width_px ?? 0), H = Number(render.height_px ?? 0);
    if (W > 0 && H > 0 && (cropX + cropW > W || cropY + cropH > H || cropX < 0 || cropY < 0)) {
      throw apiError_("VALIDATION_FAILED", "crop coordinates outside page bounds");
    }

    const driveRootId = PropertiesService.getScriptProperties().getProperty("DRIVE_ROOT_ID");
    if (!driveRootId) throw apiError_("INTERNAL", "DRIVE_ROOT_ID not configured");
    const root = DriveApp.getFolderById(driveRootId);
    const breedFolder = ensureSubfolder_(root, `${breed.slug}__${breed.breed_id}`);
    const profileFolder = ensureSubfolder_(breedFolder, `${slugify_(profile.groom_type)}__${profile.profile_id}`);
    const cropsFolder = ensureSubfolder_(profileFolder, "03-cropped-diagrams");

    const cleanB64 = String(blobB64).replace(/^data:[^,]+,/, "");
    const bytes = Utilities.base64Decode(cleanB64);
    const imageId = nextId_("image");
    const pageNum = String(Number(render.page_index ?? 0)).padStart(2, "0");
    const filename = `${role}__x${cropX}_y${cropY}_w${cropW}_h${cropH}__from-page-${pageNum}__${imageId}.jpg`;
    const blob = Utilities.newBlob(bytes, "image/jpeg", filename);
    const file = cropsFolder.createFile(blob);
    makeFilePublicForServing_(file);

    // Enforce one-main-per-profile.
    const imagesSheet = getDb_().getSheetByName("Images");
    const imagesRead = readSheet_("Images");
    if (role === "main") {
      const existingMain = imagesRead.rows.find((i) => i.profile_id === profileId && i.image_role === "main");
      if (existingMain) {
        writeRow_(imagesSheet, imagesRead.headers, existingMain._rowIndex, {
          image_role: "supplementary",
          last_recropped_date: nowIso_(),
        });
      }
    }

    appendRow_(imagesSheet, imagesRead.headers, {
      image_id: imageId,
      profile_id: profileId,
      image_role: role,
      source_page_render_id: pageRenderId,
      crop_x: cropX, crop_y: cropY,
      crop_w: cropW, crop_h: cropH,
      drive_file_id: file.getId(),
      display_position: imagesRead.rows.filter((i) => i.profile_id === profileId).length + 1,
      approved: "TRUE",
      created_date: nowIso_(),
      last_recropped_date: "",
    });

    return {
      image_id: imageId,
      drive_file_id: file.getId(),
      role,
      url: imageProxyUrl_(file.getId()),
    };
  });
}

// ─── Drive file sharing helpers ─────────────────────────────────────
//
// The snipping tool loads page renders + crops into <img crossorigin="anonymous">
// elements so Cropper.js can canvas.toDataURL() the cropped region without a
// "tainted canvas" SecurityError. Drive's drive.google.com/uc URLs strip cookies
// when crossorigin is set, so private files return 403. We make every uploaded
// image publicly viewable (link-only, unguessable image_id-based filename) and
// serve via lh3.googleusercontent.com which returns CORS-permissive headers.

function makeFilePublicForServing_(file) {
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (err) {
    // Best-effort. If sharing change fails (e.g. Drive policy), the snipping
    // tool will fail to load — surface the error to ops alerts.
    Logger.log(`[crops] could not set sharing on ${file.getId()}: ${err}`);
  }
}

/**
 * One-shot fix-up: walk Page Renders + Images sheets, set every referenced
 * Drive file to ANYONE_WITH_LINK / VIEW. Run once after deploying this code
 * to retro-fit images uploaded before the sharing change landed.
 */
function makeAllImagesPublic() {
  Logger.log("=== makeAllImagesPublic() ===");
  let fixed = 0, skipped = 0, failed = 0;
  for (const sheetName of ["Page Renders", "Images"]) {
    const { rows } = readSheet_(sheetName);
    for (const r of rows) {
      const id = r.drive_file_id;
      if (!id) { skipped++; continue; }
      try {
        const file = DriveApp.getFileById(id);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        fixed++;
      } catch (err) {
        Logger.log(`  failed ${sheetName} ${id}: ${err}`);
        failed++;
      }
    }
  }
  Logger.log(`Done. fixed=${fixed} skipped=${skipped} failed=${failed}`);
  return { fixed, skipped, failed };
}

// ─── op: list_crops_for_render ──────────────────────────────────────
//
// Return all crops for a specific page render, used by snip.html to draw
// existing-crop overlays.

function op_list_crops_for_render(body) {
  const renderId = String(body.page_render_id ?? "").trim();
  if (!renderId) throw apiError_("VALIDATION_FAILED", "page_render_id required");
  const { rows } = readSheet_("Images");
  const items = rows
    .filter((i) => i.source_page_render_id === renderId && (i.approved === true || i.approved === "TRUE"))
    .map((i) => ({
      image_id: i.image_id,
      image_role: i.image_role,
      crop_x: Number(i.crop_x ?? 0),
      crop_y: Number(i.crop_y ?? 0),
      crop_w: Number(i.crop_w ?? 0),
      crop_h: Number(i.crop_h ?? 0),
      drive_file_id: i.drive_file_id,
    }));
  return { crops: items };
}

// ─── op: delete_page_render ─────────────────────────────────────────
//
// Soft-delete a page render and cascade soft-delete every crop snipped
// from it (Images rows whose source_page_render_id matches). Drive blobs
// for both are kept — Page Renders gains a `deleted_at` stamp, Images
// rows get approved=FALSE + display_position=-1 (same shape as
// op_delete_image). The publish flow already filters approved=TRUE.

function op_delete_page_render(body) {
  const renderId = String(body.page_render_id ?? "").trim();
  if (!renderId) throw apiError_("VALIDATION_FAILED", "page_render_id required");

  const renderSheet = getDb_().getSheetByName("Page Renders");
  const rendersRead = readSheet_("Page Renders");
  const render = rendersRead.rows.find((r) => r.page_render_id === renderId);
  if (!render) throw apiError_("NOT_FOUND", `page render '${renderId}' not found`);
  if (render.deleted_at) {
    return { page_render_id: renderId, deleted: true, cascaded_image_ids: [], already_deleted: true };
  }
  const profileId = render.profile_id;

  return withProfileLock_(profileId, 30000, () => {
    // Re-read inside the lock so we see any in-flight writes.
    const renders2 = readSheet_("Page Renders");
    const render2 = renders2.rows.find((r) => r.page_render_id === renderId);
    if (!render2 || render2.deleted_at) {
      return { page_render_id: renderId, deleted: true, cascaded_image_ids: [], already_deleted: true };
    }

    const imagesSheet = getDb_().getSheetByName("Images");
    const imagesRead = readSheet_("Images");
    const cascadedImageIds = [];
    for (const img of imagesRead.rows) {
      if (img.source_page_render_id !== renderId) continue;
      if (img.approved !== true && img.approved !== "TRUE") continue;
      writeRow_(imagesSheet, imagesRead.headers, img._rowIndex, {
        approved: "FALSE",
        display_position: -1,
        last_recropped_date: nowIso_(),
      });
      cascadedImageIds.push(img.image_id);
    }

    writeRow_(renderSheet, renders2.headers, render2._rowIndex, {
      deleted_at: nowIso_(),
    });

    return { page_render_id: renderId, deleted: true, cascaded_image_ids: cascadedImageIds };
  });
}
