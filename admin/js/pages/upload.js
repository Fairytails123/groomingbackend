// Upload page — manual image upload (pre-Cropper).

import { requireSession, wireLogoutLink } from "../auth.js";
import { api, ApiError } from "../api.js";
import { toast, toastSuccess, toastError, confirmDialog } from "../ui.js";

if (!requireSession()) throw new Error("redirecting to login");
wireLogoutLink();

const profileSelect = document.getElementById("profile-select");
const profileMeta = document.getElementById("profile-meta");
const roleSelect = document.getElementById("image-role");
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file-input");
const browseBtn = document.getElementById("browse-button");
const previewWrap = document.getElementById("preview-wrap");
const previewImg = document.getElementById("preview");
const fileMeta = document.getElementById("file-meta");
const uploadBtn = document.getElementById("upload-button");
const resetBtn = document.getElementById("reset-button");
const existingImagesEl = document.getElementById("existing-images");

let selectedFile = null;
let selectedDataUrl = null;

(async () => {
  // Load all (non-archived) profiles for the picker.
  await loadProfiles();
  await loadExistingForCurrent();

  profileSelect.addEventListener("change", loadExistingForCurrent);

  // Drop zone wiring
  dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("dropzone--active"); });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dropzone--active"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dropzone--active");
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
  browseBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => { if (e.target.files[0]) handleFile(e.target.files[0]); });

  uploadBtn.addEventListener("click", doUpload);
  resetBtn.addEventListener("click", clearSelection);
})();

async function loadProfiles() {
  try {
    const data = await api("list_breeds");
    profileSelect.innerHTML = "";

    // For each breed, fetch its profiles and flatten. To avoid N+1, we just
    // list breed names; the user can pick a breed and we'll then load its
    // profiles. Until we have a list_all_profiles op, we'll just list breeds
    // and let the user pick one — and use the breed_id route.
    if (data.breeds.length === 0) {
      profileSelect.innerHTML = `<option value="">No breeds yet — add one in the library first.</option>`;
      return;
    }
    profileSelect.innerHTML = `<option value="">— select a breed —</option>` +
      data.breeds.map((b) => `<option value="${escapeAttr(b.breed_id)}">${escapeText(b.breed_name)} (${b.published_count} live, ${b.profile_count - b.published_count} draft)</option>`).join("");

    profileSelect.addEventListener("change", async () => {
      const breedId = profileSelect.value;
      if (!breedId) {
        profileMeta.textContent = "";
        return;
      }
      // Fetch the default profile for this breed.
      try {
        const detail = await api("get_breed_profile", { breed_id: breedId });
        if (!detail.profile) {
          profileMeta.innerHTML = `<span class="muted">No profile yet for this breed. <a href="profile.html?breed_id=${encodeURIComponent(breedId)}">Create one</a> first.</span>`;
          uploadBtn.disabled = true;
        } else {
          profileMeta.textContent = `Targeting profile ${detail.profile.profile_id} (${detail.profile.groom_type}, ${detail.profile.status}).`;
          uploadBtn.disabled = !selectedFile;
          profileSelect.dataset.profileId = detail.profile.profile_id;
        }
      } catch (err) {
        profileMeta.textContent = "";
      }
    }, { once: false });
  } catch {
    profileSelect.innerHTML = `<option value="">Failed to load breeds.</option>`;
  }
}

async function loadExistingForCurrent() {
  const profileId = profileSelect.dataset.profileId;
  if (!profileId) {
    existingImagesEl.innerHTML = `<p class="muted">Pick a profile above.</p>`;
    return;
  }
  try {
    const data = await api("list_images", { profile_id: profileId });
    if (!data.images?.length) {
      existingImagesEl.innerHTML = `<p class="muted">No images yet.</p>`;
      return;
    }
    existingImagesEl.innerHTML = "";
    for (const img of data.images) {
      const tile = document.createElement("div");
      tile.className = "image-tile";
      tile.innerHTML = `
        <img alt="${escapeAttr(img.image_role)}" src="">
        <span class="image-tile__role">${escapeText(img.image_role)}</span>
        <button type="button" data-image-id="${escapeAttr(img.image_id)}">Delete</button>`;
      existingImagesEl.appendChild(tile);
      tile.querySelector("button").addEventListener("click", async () => {
        const ok = await confirmDialog({
          title: "Delete image?",
          body: `This will hide ${img.image_role} from the breed pack. The Drive file is kept (referenced by version history).`,
          confirmLabel: "Delete",
          danger: true,
        });
        if (ok) {
          await api("delete_image", { image_id: img.image_id });
          toastSuccess("Image deleted");
          loadExistingForCurrent();
        }
      });
    }
  } catch {
    existingImagesEl.innerHTML = `<p class="muted">Couldn't load images.</p>`;
  }
}

function handleFile(file) {
  if (!file.type.match(/^image\/(jpeg|png)$/)) {
    toastError("Only JPEG or PNG accepted.");
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    toastError("File too large. Keep under 8 MB.");
    return;
  }
  selectedFile = file;
  const reader = new FileReader();
  reader.onload = (e) => {
    selectedDataUrl = e.target.result;
    previewImg.src = selectedDataUrl;
    fileMeta.textContent = `${file.name} — ${(file.size / 1024).toFixed(0)} KB`;
    previewWrap.hidden = false;
    uploadBtn.disabled = !profileSelect.dataset.profileId;
  };
  reader.readAsDataURL(file);
}

function clearSelection() {
  selectedFile = null;
  selectedDataUrl = null;
  previewImg.src = "";
  previewWrap.hidden = true;
  fileInput.value = "";
  uploadBtn.disabled = true;
}

async function doUpload() {
  const profileId = profileSelect.dataset.profileId;
  if (!profileId || !selectedFile || !selectedDataUrl) return;
  uploadBtn.disabled = true;
  uploadBtn.textContent = "Uploading…";
  try {
    await api("save_image_record", {
      profile_id: profileId,
      image_role: roleSelect.value,
      filename: selectedFile.name,
      jpeg_blob_b64: selectedDataUrl,
    });
    toastSuccess(`Uploaded as ${roleSelect.value}`);
    clearSelection();
    loadExistingForCurrent();
  } catch (err) {
    if (err instanceof ApiError && err.code === "VALIDATION_FAILED") toast(err.message, "error");
  } finally {
    uploadBtn.disabled = !selectedFile;
    uploadBtn.textContent = "Upload";
  }
}

function escapeText(s) { return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function escapeAttr(s) { return escapeText(s).replace(/"/g, "&quot;"); }
