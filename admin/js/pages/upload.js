// Upload page — PDF intake (Stage 3 Phase 2 — browser-orchestrated) and the
// older manual image upload, in two tabs.

import { requireSession, wireLogoutLink } from "../auth.js";
import { api, ApiError } from "../api.js";
import { toast, toastSuccess, toastError, confirmDialog } from "../ui.js";

if (!requireSession()) throw new Error("redirecting to login");
wireLogoutLink();

// ─── Tab switching ──────────────────────────────────────────────────

const tabs = document.getElementById("upload-tabs");
const panels = {
  pdf: document.getElementById("tab-pdf-panel"),
  image: document.getElementById("tab-image-panel"),
};

let imageInited = false;

tabs.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-tab]");
  if (!btn) return;
  setActiveTab(btn.dataset.tab);
});

function setActiveTab(name) {
  for (const tab of tabs.querySelectorAll(".tab")) {
    const isActive = tab.dataset.tab === name;
    tab.classList.toggle("tab--active", isActive);
    tab.setAttribute("aria-selected", isActive ? "true" : "false");
  }
  for (const [key, el] of Object.entries(panels)) {
    el.hidden = key !== name;
  }
  if (name === "image" && !imageInited) {
    imageInited = true;
    initImageUpload();
  }
}

// ─── PDF intake panel ───────────────────────────────────────────────

const pdfBreedSelect = document.getElementById("pdf-breed-select");
const pdfProfileMeta = document.getElementById("pdf-profile-meta");
const pdfDropzone = document.getElementById("pdf-dropzone");
const pdfFileInput = document.getElementById("pdf-file-input");
const pdfBrowseBtn = document.getElementById("pdf-browse-button");
const pdfFileMeta = document.getElementById("pdf-file-meta");
const pdfStartBtn = document.getElementById("pdf-start-button");
const pdfResetBtn = document.getElementById("pdf-reset-button");
const pdfProgressCard = document.getElementById("pdf-progress-card");
const pdfStatusText = document.getElementById("pdf-status-text");
const pdfLogEl = document.getElementById("pdf-log");
const pdfDoneActions = document.getElementById("pdf-done-actions");
const pdfDoneLink = document.getElementById("pdf-done-link");
const pdfStepEls = Object.fromEntries(
  Array.from(document.querySelectorAll(".pdf-step")).map((el) => [el.dataset.step, el])
);

let pdfSelectedFile = null;
let pdfSelectedProfileId = null;

(async () => {
  await loadPdfBreedSelect();

  // Wire dropzone + file input
  pdfDropzone.addEventListener("dragover", (e) => { e.preventDefault(); pdfDropzone.classList.add("dropzone--active"); });
  pdfDropzone.addEventListener("dragleave", () => pdfDropzone.classList.remove("dropzone--active"));
  pdfDropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    pdfDropzone.classList.remove("dropzone--active");
    if (e.dataTransfer.files[0]) handlePdfFile(e.dataTransfer.files[0]);
  });
  pdfBrowseBtn.addEventListener("click", () => pdfFileInput.click());
  pdfFileInput.addEventListener("change", (e) => { if (e.target.files[0]) handlePdfFile(e.target.files[0]); });

  pdfStartBtn.addEventListener("click", onStartExtraction);
  pdfResetBtn.addEventListener("click", clearPdfSelection);

  pdfBreedSelect.addEventListener("change", onPdfBreedChange);

  // Re-extract auto-trigger from profile.html "Re-extract sections" button.
  const params = new URLSearchParams(location.search);
  if (params.get("reextract") === "1") {
    await tryReextractFromSessionStorage();
  }
})();

async function loadPdfBreedSelect() {
  try {
    const data = await api("list_breeds");
    if (!data.breeds?.length) {
      pdfBreedSelect.innerHTML = `<option value="">No breeds yet — add one in the library first.</option>`;
      return;
    }
    pdfBreedSelect.innerHTML = `<option value="">— select a breed —</option>` +
      data.breeds.map((b) => `<option value="${escapeAttr(b.breed_id)}">${escapeText(b.breed_name)}</option>`).join("");
  } catch {
    pdfBreedSelect.innerHTML = `<option value="">Failed to load breeds.</option>`;
  }
}

async function onPdfBreedChange() {
  const breedId = pdfBreedSelect.value;
  pdfSelectedProfileId = null;
  pdfProfileMeta.textContent = "";
  refreshStartEnabled();
  if (!breedId) return;
  try {
    const detail = await api("get_breed_profile", { breed_id: breedId });
    if (!detail.profile) {
      pdfProfileMeta.innerHTML = `<span class="muted">No profile yet for this breed. <a href="profile.html?breed_id=${encodeURIComponent(breedId)}">Create one</a> first.</span>`;
      return;
    }
    pdfSelectedProfileId = detail.profile.profile_id;
    pdfProfileMeta.textContent = `Targeting profile ${detail.profile.profile_id} (${detail.profile.groom_type}, ${detail.profile.status}).`;
    refreshStartEnabled();
  } catch {
    pdfProfileMeta.textContent = "Could not load profile.";
  }
}

async function handlePdfFile(file) {
  if (file.type !== "application/pdf") {
    toastError("Only PDF accepted. Use Adobe Scan to convert phone photos.");
    return;
  }
  if (file.size > 60 * 1024 * 1024) {
    toastError("PDF too large. Keep under 60 MB.");
    return;
  }
  pdfSelectedFile = file;
  pdfFileMeta.textContent = `${file.name} — ${(file.size / (1024 * 1024)).toFixed(1)} MB`;

  // Show page count once pdf.js is loaded — non-blocking nice-to-have.
  try {
    const { getPageCount } = await import("../pdf.js");
    const n = await getPageCount(file);
    pdfFileMeta.textContent = `${file.name} — ${(file.size / (1024 * 1024)).toFixed(1)} MB, ${n} page(s)`;
  } catch (err) {
    console.warn("[upload] could not read page count:", err);
  }

  refreshStartEnabled();
}

function clearPdfSelection() {
  pdfSelectedFile = null;
  pdfFileInput.value = "";
  pdfFileMeta.textContent = "";
  refreshStartEnabled();
}

function refreshStartEnabled() {
  pdfStartBtn.disabled = !(pdfSelectedFile && pdfSelectedProfileId);
}

async function onStartExtraction() {
  if (!pdfSelectedFile || !pdfSelectedProfileId) return;
  const profileId = pdfSelectedProfileId;
  await runIntakeWithUi({ profileId, pdfFile: pdfSelectedFile });
}

async function tryReextractFromSessionStorage() {
  const profileId = sessionStorage.getItem("ft_reextract_profile_id");
  const pdfB64 = sessionStorage.getItem("ft_reextract_pdf_b64");
  const filename = sessionStorage.getItem("ft_reextract_filename") ?? "source.pdf";
  if (!profileId || !pdfB64) return;
  // Clear immediately so a refresh doesn't loop.
  sessionStorage.removeItem("ft_reextract_pdf_b64");
  sessionStorage.removeItem("ft_reextract_filename");
  sessionStorage.removeItem("ft_reextract_profile_id");

  // Try to surface what we're targeting.
  pdfBreedSelect.disabled = true;
  pdfProfileMeta.textContent = `Re-extracting profile ${profileId} from existing source PDF.`;
  pdfFileMeta.textContent = `${filename} (re-extract)`;

  await runIntakeWithUi({ profileId, pdfB64, originalFilename: filename, skipPageRenders: true });
}

async function runIntakeWithUi({ profileId, pdfFile, pdfB64, originalFilename, skipPageRenders = false }) {
  const { runPdfIntake } = await import("../pdf-intake.js");

  pdfStartBtn.disabled = true;
  pdfResetBtn.disabled = true;
  pdfProgressCard.hidden = false;
  resetSteps();
  pdfLogEl.textContent = "";
  pdfDoneActions.hidden = true;
  pdfStatusText.textContent = "Starting…";

  try {
    const result = await runPdfIntake({
      profileId,
      pdfFile,
      pdfB64,
      originalFilename,
      skipPageRenders,
      onProgress: handleProgress,
    });
    pdfStatusText.textContent = `Done — status ${result.status}. ${result.partial_failures.length || 0} page(s) had vision warnings.`;
    pdfDoneLink.href = `profile.html?profile_id=${encodeURIComponent(profileId)}`;
    pdfDoneActions.hidden = false;
    toastSuccess("Extraction complete.");
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : (err?.message ?? String(err));
    pdfStatusText.textContent = `Failed: ${msg}`;
    appendLog(`✖ ${msg}`);
    // ApiError is already toasted by api.js (except VALIDATION_FAILED / CONFLICT — but
    // those shouldn't reach here mid-pipeline); avoid the double-toast.
    if (!(err instanceof ApiError)) toastError(msg);
  } finally {
    pdfStartBtn.disabled = false;
    pdfResetBtn.disabled = false;
  }
}

function handleProgress(p) {
  if (p.message) pdfStatusText.textContent = p.message;
  if (p.step) {
    setStepStatus(p.step, p.status);
  }
  if (p.message) appendLog(p.message);
}

function setStepStatus(step, status) {
  const el = pdfStepEls[step];
  if (!el) return;
  const pill = el.querySelector(".pdf-step__pill");
  el.classList.remove("pdf-step--running", "pdf-step--done", "pdf-step--warning", "pdf-step--skipped");
  if (status === "running") {
    el.classList.add("pdf-step--running");
    pill.textContent = "running";
  } else if (status === "done") {
    el.classList.add("pdf-step--done");
    pill.textContent = "done";
  } else if (status === "warning") {
    el.classList.add("pdf-step--warning");
    pill.textContent = "warning";
  } else if (status === "skipped") {
    el.classList.add("pdf-step--skipped");
    pill.textContent = "skipped";
  } else {
    pill.textContent = String(status ?? "queued");
  }
}

function resetSteps() {
  for (const el of Object.values(pdfStepEls)) {
    el.classList.remove("pdf-step--running", "pdf-step--done", "pdf-step--warning", "pdf-step--skipped");
    el.querySelector(".pdf-step__pill").textContent = "queued";
  }
}

function appendLog(message) {
  const ts = new Date().toLocaleTimeString();
  pdfLogEl.textContent += `[${ts}] ${message}\n`;
  pdfLogEl.scrollTop = pdfLogEl.scrollHeight;
}

// ─── Image upload panel (legacy — kept as fallback) ─────────────────
//
// Lazy-initialised so loading the page on the PDF tab doesn't pay for
// loading every breed's profile up front.

function initImageUpload() {
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

  loadProfiles();
  loadExistingForCurrent();

  profileSelect.addEventListener("change", onBreedChange);

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

  async function loadProfiles() {
    try {
      const data = await api("list_breeds");
      if (!data.breeds?.length) {
        profileSelect.innerHTML = `<option value="">No breeds yet — add one in the library first.</option>`;
        return;
      }
      profileSelect.innerHTML = `<option value="">— select a breed —</option>` +
        data.breeds.map((b) => `<option value="${escapeAttr(b.breed_id)}">${escapeText(b.breed_name)} (${b.published_count} live, ${b.profile_count - b.published_count} draft)</option>`).join("");
    } catch {
      profileSelect.innerHTML = `<option value="">Failed to load breeds.</option>`;
    }
  }

  async function onBreedChange() {
    const breedId = profileSelect.value;
    if (!breedId) {
      profileMeta.textContent = "";
      profileSelect.dataset.profileId = "";
      uploadBtn.disabled = true;
      return;
    }
    try {
      const detail = await api("get_breed_profile", { breed_id: breedId });
      if (!detail.profile) {
        profileMeta.innerHTML = `<span class="muted">No profile yet for this breed. <a href="profile.html?breed_id=${encodeURIComponent(breedId)}">Create one</a> first.</span>`;
        uploadBtn.disabled = true;
      } else {
        profileMeta.textContent = `Targeting profile ${detail.profile.profile_id} (${detail.profile.groom_type}, ${detail.profile.status}).`;
        profileSelect.dataset.profileId = detail.profile.profile_id;
        uploadBtn.disabled = !selectedFile;
        loadExistingForCurrent();
      }
    } catch (err) {
      profileMeta.textContent = "";
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
}

// ─── Helpers ────────────────────────────────────────────────────────

function escapeText(s) { return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function escapeAttr(s) { return escapeText(s).replace(/"/g, "&quot;"); }
