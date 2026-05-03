// Snipping tool — Cropper.js + crop save flow.

import { requireSession, wireLogoutLink } from "../auth.js";
import { api, ApiError } from "../api.js";
import { toast, toastSuccess, toastError, confirmDialog } from "../ui.js";

if (!requireSession()) throw new Error("redirecting to login");
wireLogoutLink();

const params = new URLSearchParams(location.search);
const profileId = params.get("profile_id");

const titleEl = document.getElementById("page-title");
const backLink = document.getElementById("back-link");
const filmstrip = document.getElementById("filmstrip");
const canvasEmpty = document.getElementById("canvas-empty");
const canvasArea = document.getElementById("canvas-area");
const snipImg = document.getElementById("snip-img");
const coordsEl = document.getElementById("coords");
const allCropsList = document.getElementById("all-crops-list");
const existingOnPageEl = document.getElementById("existing-on-page");
const statusEl = document.getElementById("status");
const addPageBtn = document.getElementById("add-page-button");
const pageFileInput = document.getElementById("page-file-input");

let pageRenders = [];
let allCrops = [];
let currentRender = null;
let cropper = null;

if (!profileId) {
  filmstrip.innerHTML = `<p class="muted center" style="padding:var(--space-4);">No profile_id in URL.</p>`;
  throw new Error("missing profile_id");
}

backLink.href = `profile.html?profile_id=${encodeURIComponent(profileId)}`;

(async () => {
  await loadProfile();
  await loadFilmstrip();
  await loadAllCrops();

  addPageBtn.addEventListener("click", () => pageFileInput.click());
  pageFileInput.addEventListener("change", async (e) => {
    if (e.target.files[0]) await uploadPageRender(e.target.files[0]);
    e.target.value = "";
  });

  for (const btn of document.querySelectorAll("[data-role]")) {
    btn.addEventListener("click", () => saveCrop(btn.dataset.role));
  }

  document.addEventListener("keydown", (e) => {
    if (!cropper) return;
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    const map = { m: "main", f: "front", b: "back", h: "head", s: "supplementary" };
    const role = map[e.key.toLowerCase()];
    if (role) { e.preventDefault(); saveCrop(role); }
  });
})();

async function loadProfile() {
  try {
    const data = await api("get_breed_profile", { profile_id: profileId });
    titleEl.textContent = `${data.breed.breed_name} / ${data.profile.groom_type} — Snipping`;
  } catch {
    titleEl.textContent = "Snipping tool";
  }
}

async function loadFilmstrip() {
  try {
    const data = await api("list_page_renders", { profile_id: profileId });
    pageRenders = data.page_renders ?? [];
    renderFilmstrip();
    if (pageRenders.length > 0 && !currentRender) {
      pickPage(pageRenders[0]);
    }
  } catch {
    filmstrip.innerHTML = `<p class="muted center">Couldn't load page renders.</p>`;
  }
}

function renderFilmstrip() {
  if (pageRenders.length === 0) {
    filmstrip.innerHTML = `<p class="muted center" style="padding:var(--space-4);">No page renders yet. Click "+ Add page render" to upload one.</p>`;
    return;
  }
  filmstrip.innerHTML = "";
  for (const r of pageRenders) {
    const cropCount = allCrops.filter((c) => c.source_page_render_id === r.page_render_id).length;
    const thumb = document.createElement("button");
    thumb.type = "button";
    thumb.className = "thumb" + (currentRender && currentRender.page_render_id === r.page_render_id ? " thumb--active" : "");
    thumb.innerHTML = `
      <span class="thumb__index">${r.page_index}</span>
      ${cropCount ? `<span class="thumb__badge">${cropCount}</span>` : ""}
      <img src="${escapeAttr(r.url ?? "")}" alt="Page ${r.page_index}" crossorigin="anonymous" referrerpolicy="no-referrer">`;
    thumb.addEventListener("click", () => pickPage(r));
    filmstrip.appendChild(thumb);
  }
}

function pickPage(render) {
  currentRender = render;
  for (const t of filmstrip.querySelectorAll(".thumb")) t.classList.remove("thumb--active");
  // Re-render to apply active class
  renderFilmstrip();

  canvasEmpty.hidden = true;
  canvasArea.hidden = false;
  if (cropper) { cropper.destroy(); cropper = null; }
  snipImg.src = render.url;
  snipImg.onload = () => {
    cropper = new Cropper(snipImg, {
      viewMode: 1,
      autoCrop: false,
      background: false,
      responsive: true,
      checkOrientation: false,
      crop(event) {
        const x = Math.round(event.detail.x);
        const y = Math.round(event.detail.y);
        const w = Math.round(event.detail.width);
        const h = Math.round(event.detail.height);
        coordsEl.textContent = `x: ${x}, y: ${y}, w: ${w}, h: ${h}`;
      },
    });
  };
  renderExistingOnPage();
}

function renderExistingOnPage() {
  if (!currentRender) { existingOnPageEl.innerHTML = ""; return; }
  const onPage = allCrops.filter((c) => c.source_page_render_id === currentRender.page_render_id);
  if (onPage.length === 0) { existingOnPageEl.innerHTML = `<em>No crops on this page yet.</em>`; return; }
  existingOnPageEl.innerHTML = `Existing crops on this page: ` +
    onPage.map((c) => `<strong>${escapeText(c.image_role)}</strong> (x${c.crop_x} y${c.crop_y} w${c.crop_w} h${c.crop_h})`).join(", ");
}

async function loadAllCrops() {
  try {
    const data = await api("list_images", { profile_id: profileId });
    allCrops = (data.images ?? []).map((img) => ({
      ...img,
      crop_x: img.crop_x ?? 0,
      crop_y: img.crop_y ?? 0,
      crop_w: img.crop_w ?? 0,
      crop_h: img.crop_h ?? 0,
    }));
    renderAllCrops();
    renderFilmstrip();
    renderExistingOnPage();
  } catch {
    allCropsList.innerHTML = `<p class="muted">Couldn't load crops.</p>`;
  }
}

function renderAllCrops() {
  if (allCrops.length === 0) { allCropsList.innerHTML = `<p class="muted">No crops yet.</p>`; return; }
  allCropsList.innerHTML = "";
  for (const c of allCrops) {
    const tile = document.createElement("div");
    tile.className = "crop-tile";
    tile.innerHTML = `
      <img src="${escapeAttr(`https://drive.google.com/uc?export=view&id=${c.drive_file_id}`)}" alt="${escapeAttr(c.image_role)}" referrerpolicy="no-referrer">
      <div style="flex:1;">
        <div class="crop-tile__role">${escapeText(c.image_role)}</div>
        <div class="crop-tile__meta">${c.crop_w}×${c.crop_h}</div>
      </div>`;
    allCropsList.appendChild(tile);
  }
}

async function uploadPageRender(file) {
  if (!file.type.match(/^image\/(jpeg|png)$/)) { toastError("JPEG or PNG only."); return; }
  if (file.size > 8 * 1024 * 1024) { toastError("File too large (max 8 MB)."); return; }

  statusEl.textContent = "Reading…";
  const dataUrl = await readFile(file);
  const dims = await imageDimensions(dataUrl);

  statusEl.textContent = "Uploading page render…";
  try {
    const result = await api("save_page_render", {
      profile_id: profileId,
      page_index: pageRenders.length + 1,
      width_px: dims.width,
      height_px: dims.height,
      jpeg_blob_b64: dataUrl,
    });
    statusEl.textContent = "";
    toastSuccess(`Page ${pageRenders.length + 1} added.`);
    await loadFilmstrip();
    const justAdded = pageRenders.find((r) => r.page_render_id === result.page_render_id);
    if (justAdded) pickPage(justAdded);
  } catch (err) {
    statusEl.textContent = "";
    if (err instanceof ApiError && err.code === "VALIDATION_FAILED") toast(err.message, "error");
  }
}

async function saveCrop(role) {
  if (!cropper) return;
  if (!currentRender) return;
  const data = cropper.getData(true);
  const w = Math.round(data.width), h = Math.round(data.height);
  if (w <= 0 || h <= 0) {
    toast("Drag a rectangle first.", "default");
    return;
  }

  if (role === "main") {
    const existingMain = allCrops.find((c) => c.image_role === "main");
    if (existingMain) {
      const ok = await confirmDialog({
        title: "Replace existing main?",
        body: `There's already a main image. Save this as main and demote the previous one to supplementary?`,
        confirmLabel: "Replace",
      });
      if (!ok) return;
    }
  }

  statusEl.textContent = `Saving ${role}…`;
  const canvas = cropper.getCroppedCanvas({ width: w, height: h, imageSmoothingQuality: "high" });
  const jpegDataUrl = canvas.toDataURL("image/jpeg", 0.92);

  try {
    await api("save_crop", {
      profile_id: profileId,
      image_role: role,
      source_page_render_id: currentRender.page_render_id,
      crop_x: Math.round(data.x),
      crop_y: Math.round(data.y),
      crop_w: w,
      crop_h: h,
      jpeg_blob_b64: jpegDataUrl,
    });
    statusEl.textContent = "";
    toastSuccess(`Saved as ${role}.`);
    cropper.clear();
    await loadAllCrops();
  } catch (err) {
    statusEl.textContent = "";
    if (err instanceof ApiError && err.code === "VALIDATION_FAILED") toast(err.message, "error");
  }
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = (e) => resolve(e.target.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function imageDimensions(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.src = dataUrl;
  });
}

function escapeText(s) { return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function escapeAttr(s) { return escapeText(s).replace(/"/g, "&quot;"); }
