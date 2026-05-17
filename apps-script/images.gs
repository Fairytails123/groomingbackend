/**
 * images.gs — image record CRUD (pre-Cropper, Stage 2 Week 3).
 *
 * In Stage 3 the snipping tool will use op_save_crop instead, which dispatches
 * to n8n WF-10 for byte-perfect server-side cropping. For now these ops let
 * Kamal upload pre-cropped JPEGs directly with a role dropdown.
 *
 * Body size limit: Apps Script POST body caps around ~10MB. Pre-cropped
 * salon images are typically 0.5-3MB so this is fine.
 */

const VALID_IMAGE_ROLES = ["main", "front", "back", "head", "supplementary"];

// ─── op: save_image_record ──────────────────────────────────────────

function op_save_image_record(body) {
  const profileId = String(body.profile_id ?? "").trim();
  const role = String(body.image_role ?? "").trim();
  const blobB64 = body.jpeg_blob_b64 ?? "";
  const filename = String(body.filename ?? "image.jpg");

  if (!profileId) throw apiError_("VALIDATION_FAILED", "profile_id required");
  if (!VALID_IMAGE_ROLES.includes(role)) {
    throw apiError_("VALIDATION_FAILED", `image_role must be one of ${VALID_IMAGE_ROLES.join(", ")}`);
  }
  if (!blobB64 || typeof blobB64 !== "string") {
    throw apiError_("VALIDATION_FAILED", "jpeg_blob_b64 required (base64-encoded JPEG)");
  }

  return withProfileLock_(profileId, 30000, () => {
    const { rows: profiles } = readSheet_("Groom Profiles");
    const profile = profiles.find((p) => p.profile_id === profileId);
    if (!profile) throw apiError_("NOT_FOUND", `profile '${profileId}' not found`);

    const breed = findBreed_(profile.breed_id);

    // Decode and write the JPEG to Drive.
    const driveRootId = PropertiesService.getScriptProperties().getProperty("DRIVE_ROOT_ID");
    if (!driveRootId) throw apiError_("INTERNAL", "DRIVE_ROOT_ID not configured");
    const root = DriveApp.getFolderById(driveRootId);
    const breedFolder = ensureSubfolder_(root, `${breed.slug}__${breed.breed_id}`);
    const profileFolder = ensureSubfolder_(breedFolder, `${slugify_(profile.groom_type)}__${profile.profile_id}`);
    const cropsFolder = ensureSubfolder_(profileFolder, "03-cropped-diagrams");

    // Strip a possible "data:image/jpeg;base64," prefix from the front-end FileReader.
    const cleanB64 = blobB64.replace(/^data:[^,]+,/, "");
    const bytes = Utilities.base64Decode(cleanB64);
    const blob = Utilities.newBlob(bytes, "image/jpeg", filename);

    const imageId = nextId_("image");
    const driveFilename = `${role}__manual__${imageId}.jpg`;
    const file = cropsFolder.createFile(blob.setName(driveFilename));

    // Enforce "exactly one main per profile": if uploading main, demote any existing main.
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
      source_page_render_id: "",   // empty for manual uploads (no snip)
      crop_x: 0, crop_y: 0,
      crop_w: 0, crop_h: 0,
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
    };
  });
}

// ─── op: list_images ────────────────────────────────────────────────

function op_list_images(body) {
  const profileId = String(body.profile_id ?? "").trim();
  if (!profileId) throw apiError_("VALIDATION_FAILED", "profile_id required");
  const { rows } = readSheet_("Images");
  const items = rows
    .filter((i) => i.profile_id === profileId)
    .map((i) => ({
      image_id: i.image_id,
      image_role: i.image_role,
      drive_file_id: i.drive_file_id,
      display_position: Number(i.display_position ?? 0),
      created_date: toIso_(i.created_date),
      last_recropped_date: toIso_(i.last_recropped_date),
    }))
    .sort((a, b) => a.display_position - b.display_position);
  return { images: items };
}

// ─── op: delete_image ───────────────────────────────────────────────

function op_delete_image(body) {
  const imageId = String(body.image_id ?? "").trim();
  if (!imageId) throw apiError_("VALIDATION_FAILED", "image_id required");

  const initialRead = readSheet_("Images");
  const initialRow = initialRead.rows.find((i) => i.image_id === imageId);
  if (!initialRow) throw apiError_("NOT_FOUND", `image '${imageId}' not found`);
  const profileId = initialRow.profile_id;

  return withProfileLock_(profileId, 30000, () => {
    // Re-read inside the lock so we see any in-flight writes (e.g. a parallel
    // save_crop that just demoted a different image's role).
    const sheet = getDb_().getSheetByName("Images");
    const { headers, rows } = readSheet_("Images");
    const row = rows.find((i) => i.image_id === imageId);
    if (!row) throw apiError_("NOT_FOUND", `image '${imageId}' not found`);
    if (row.approved !== true && row.approved !== "TRUE") {
      return { image_id: imageId, deleted: true, already_deleted: true };
    }

    // Soft-delete: keep the Drive blob (referenced by version history),
    // but remove the row from active records by setting display_position = -1
    // and approved = FALSE. The publish flow only includes approved=TRUE images.
    writeRow_(sheet, headers, row._rowIndex, {
      approved: "FALSE",
      display_position: -1,
      last_recropped_date: nowIso_(),
    });
    return { image_id: imageId, deleted: true };
  });
}

// ─── op: list_drafts (for publish page) ─────────────────────────────

function op_list_drafts(body) {
  const { rows: profiles } = readSheet_("Groom Profiles");
  const drafts = profiles
    .filter((p) => p.status === "Draft" || p.status === "Needs Review")
    .map((p) => ({
      profile_id: p.profile_id,
      breed_id: p.breed_id,
      breed_name: p.breed_name,
      groom_type: p.groom_type,
      status: p.status,
      current_version: Number(p.current_version ?? 1),
      published_version: p.published_version ? Number(p.published_version) : null,
      updated_at: toIso_(p.updated_at),
    }))
    .sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")));

  return { drafts };
}
