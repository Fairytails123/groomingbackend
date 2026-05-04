// admin/js/pages/snip.js — REDESIGNED.
//
// Drop-in replacement for the existing snip.js. Same API contract
// (uses api(), requireSession, toast helpers from ../auth.js / ../api.js
// / ../ui.js — no other module changes required).
//
// What's new vs. the old snip.js:
//   • Renders the Apple-style filmstrip thumbnails (page index + crop badge).
//   • Drives the floating action bar visibility (shown only when a crop
//     rectangle exists; hidden otherwise).
//   • Renders a per-role checklist + progress count in the page header.
//   • Updates the breadcrumbs (BREED · GROOM TYPE) and "Add first page"
//     empty-state button.
//   • Cropper.js is configured to leave the bottom of the canvas free
//     for the floating toolbar.
//
// External contract is unchanged:
//   GET  list_page_renders   { profile_id }
//   GET  list_images         { profile_id }
//   POST save_page_render    { profile_id, page_index, width_px, height_px, jpeg_blob_b64 }
//   POST save_crop           { profile_id, image_role, source_page_render_id,
//                              crop_x, crop_y, crop_w, crop_h, jpeg_blob_b64 }

import { requireSession, wireLogoutLink } from "../auth.js";
import { api, ApiError } from "../api.js";
import { toast, toastSuccess, toastError, confirmDialog } from "../ui.js";

if (!requireSession()) throw new Error("redirecting to login");
wireLogoutLink();

/* ─── Constants ──────────────────────────────────────────────────── */

const ROLES = [
  { id: "main",          label: "Main",  key: "M", swatch: "var(--role-main)",  required: true  },
  { id: "front",         label: "Front", key: "F", swatch: "var(--role-front)", required: true  },
  { id: "back",          label: "Back",  key: "B", swatch: "var(--role-back)",  required: true  },
  { id: "head",          label: "Head",  key: "H", swatch: "var(--role-head)",  required: true  },
  { id: "supplementary", label: "Extra", key: "S", swatch: "var(--role-supp)",  required: false },
];
const REQUIRED_TOTAL = ROLES.filter((r) => r.required).length;

/* ─── DOM ────────────────────────────────────────────────────────── */

const params = new URLSearchParams(location.search);
const profileId = params.get("profile_id");

const $ = (id) => document.getElementById(id);

const titleEl       = $("page-title");
const crumbsEl      = $("page-crumbs");
const backLink      = $("back-link");
const filmstrip     = $("filmstrip");
const canvasEmpty   = $("canvas-empty");
const imgWrap       = $("snip-img-wrap");
const snipImg       = $("snip-img");
const allCropsList  = $("all-crops-list");
const checklistEl   = $("role-checklist");
const statusEl      = $("status");
const stageHint     = $("stage-hint");
const actionbar     = $("actionbar");
const addPageBtn    = $("add-page-button");
const emptyAddBtn   = $("empty-add-btn");
const pageFileInput = $("page-file-input");
const resetCropBtn  = $("reset-crop");
const pageCountEl   = $("page-count");
const cropCountEl   = $("crop-count");
const progressDone  = $("progress-done");
const progressTotal = $("progress-total");

progressTotal.textContent = String(REQUIRED_TOTAL);

/* ─── State ──────────────────────────────────────────────────────── */

let pageRenders = [];
let allCrops = [];
let currentRender = null;
let cropper = null;
let cropperData = null; // last reported {x,y,w,h}

if (!profileId) {
  filmstrip.innerHTML = `<p class="muted center" style="padding:12px;">No profile_id in URL.</p>`;
  throw new Error("missing profile_id");
}
backLink.href = `profile.html?profile_id=${encodeURIComponent(profileId)}`;

/* ─── Boot ───────────────────────────────────────────────────────── */

(async () => {
  await loadProfile();
  await loadFilmstrip();
  await loadAllCrops();
  renderChecklist();

  addPageBtn.addEventListener("click", () => pageFileInput.click());
  emptyAddBtn?.addEventListener("click", () => pageFileInput.click());
  pageFileInput.addEventListener("change", async (e) => {
    if (e.target.files[0]) await uploadPageRender(e.target.files[0]);
    e.target.value = "";
  });

  for (const btn of document.querySelectorAll("[data-role]")) {
    btn.addEventListener("click", () => saveCrop(btn.dataset.role));
  }

  resetCropBtn.addEventListener("click", () => {
    if (cropper) cropper.clear();
    setActionbarVisible(false);
  });

  document.addEventListener("keydown", (e) => {
    if (!cropper) return;
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    if (e.key === "Escape") {
      cropper.clear();
      setActionbarVisible(false);
      return;
    }
    const map = { m: "main", f: "front", b: "back", h: "head", s: "supplementary" };
    const role = map[e.key.toLowerCase()];
    if (role) {
      e.preventDefault();
      saveCrop(role);
    }
  });
})();

/* ─── Load profile (breed name + groom type for breadcrumbs) ─────── */

async function loadProfile() {
  try {
    const data = await api("get_breed_profile", { profile_id: profileId });
    const breed = data.breed?.breed_name ?? "Breed";
    const groom = data.profile?.groom_type ?? "Groom";
    crumbsEl.textContent = `${breed.toUpperCase()} · ${String(groom).toUpperCase()}`;
    titleEl.textContent  = "Snipping tool";
  } catch {
    crumbsEl.textContent = "";
    titleEl.textContent  = "Snipping tool";
  }
}

/* ─── Filmstrip ──────────────────────────────────────────────────── */

async function loadFilmstrip() {
  try {
    const data = await api("list_page_renders", { profile_id: profileId });
    pageRenders = data.page_renders ?? [];
    renderFilmstrip();
    if (pageRenders.length > 0 && !currentRender) {
      pickPage(pageRenders[0]);
    }
  } catch {
    filmstrip.innerHTML = `<p class="muted center" style="padding:12px;">Couldn't load page renders.</p>`;
  }
}

function renderFilmstrip() {
  pageCountEl.textContent = String(pageRenders.length);

  if (pageRenders.length === 0) {
    filmstrip.innerHTML = "";
    appendAddPageTile();
    return;
  }

  filmstrip.innerHTML = "";
  for (const r of pageRenders) {
    const cropCount = allCrops.filter((c) => c.source_page_render_id === r.page_render_id).length;
    const isActive  = currentRender && currentRender.page_render_id === r.page_render_id;

    const thumb = document.createElement("button");
    thumb.type = "button";
    thumb.className = "snip-thumb" + (isActive ? " snip-thumb--active" : "");
    thumb.setAttribute("aria-current", isActive ? "true" : "false");
    thumb.innerHTML = `
      <span class="snip-thumb__index">${escapeText(r.page_index)}</span>
      ${cropCount ? `<span class="snip-thumb__badge">${cropCount}</span>` : ""}
      <div class="snip-thumb__page">
        <img src="${escapeAttr(r.url ?? "")}" alt="Page ${escapeAttr(r.page_index)}"
             crossorigin="anonymous" referrerpolicy="no-referrer">
      </div>
      <div class="snip-thumb__footer">
        <span>Page ${escapeText(r.page_index)}</span>
        <span style="color: var(--snip-brand-blue); font-weight: 600;">
          ${cropCount ? cropCount + ' crop' + (cropCount === 1 ? '' : 's') : ''}
        </span>
      </div>`;
    thumb.addEventListener("click", () => pickPage(r));
    filmstrip.appendChild(thumb);
  }

  appendAddPageTile();
}

function appendAddPageTile() {
  const add = document.createElement("button");
  add.type = "button";
  add.className = "snip-thumb snip-thumb--add";
  add.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>
    Add page`;
  add.addEventListener("click", () => pageFileInput.click());
  filmstrip.appendChild(add);
}

/* ─── Pick page → mount Cropper ──────────────────────────────────── */

function pickPage(render) {
  currentRender = render;
  renderFilmstrip();

  canvasEmpty.hidden = true;
  imgWrap.hidden = false;

  if (cropper) { cropper.destroy(); cropper = null; }

  snipImg.src = render.url;
  snipImg.onload = () => {
    cropper = new Cropper(snipImg, {
      viewMode: 1,
      autoCrop: false,
      background: false,
      responsive: true,
      checkOrientation: false,
      modal: true,
      // leave breathing room at the bottom for the floating toolbar
      cropBoxResizable: true,
      crop(event) {
        const x = Math.round(event.detail.x);
        const y = Math.round(event.detail.y);
        const w = Math.round(event.detail.width);
        const h = Math.round(event.detail.height);
        cropperData = { x, y, w, h };
        if (w > 0 && h > 0) {
          setActionbarVisible(true);
        } else {
          setActionbarVisible(false);
        }
      },
      cropend() {
        if (cropperData && cropperData.w > 0 && cropperData.h > 0) {
          setActionbarVisible(true);
        }
      },
    });
  };
}

function setActionbarVisible(visible) {
  actionbar.classList.toggle("is-hidden", !visible);
  stageHint.classList.toggle("is-hidden", visible);
}

/* ─── All crops + checklist ──────────────────────────────────────── */

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
    renderChecklist();
  } catch {
    allCropsList.innerHTML = `<p class="muted center" style="padding:16px;font-size:13px;">Couldn't load crops.</p>`;
  }
}

function renderAllCrops() {
  cropCountEl.textContent = String(allCrops.length);
  if (allCrops.length === 0) {
    allCropsList.innerHTML = `
      <div style="padding: 24px 8px; text-align: center; color: var(--snip-secondary); font-size: 13px;">
        <div style="margin: 0 auto 12px; width: 48px; height: 48px; border-radius: 14px;
                    background: var(--snip-surface-2); display: flex; align-items: center;
                    justify-content: center; color: var(--snip-tertiary);">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="3"/>
            <path d="M3 15l5-5 4 4 3-3 6 6"/>
          </svg>
        </div>
        No crops yet.<br>
        <span style="font-size: 12px;">Drag on the page, then choose a role.</span>
      </div>`;
    return;
  }

  allCropsList.innerHTML = "";
  for (const c of allCrops) {
    const role = ROLES.find((r) => r.id === c.image_role) ?? ROLES.at(-1);
    const sourcePage = pageRenders.find((p) => p.page_render_id === c.source_page_render_id);
    const tile = document.createElement("div");
    tile.className = "snip-crop-tile";
    tile.style.setProperty("--swatch", role.swatch);
    tile.innerHTML = `
      <div class="snip-crop-tile__thumb">
        <img src="${escapeAttr(`https://lh3.googleusercontent.com/d/${c.drive_file_id}=s200`)}"
             alt="${escapeAttr(role.label)}" referrerpolicy="no-referrer">
      </div>
      <div class="snip-crop-tile__body">
        <div class="snip-crop-tile__role"><span class="swatch"></span> ${escapeText(role.label)}</div>
        <div class="snip-crop-tile__meta">${c.crop_w} × ${c.crop_h} px</div>
        ${sourcePage
          ? `<div class="snip-crop-tile__source">From page ${escapeText(sourcePage.page_index)}</div>`
          : ""}
      </div>`;
    allCropsList.appendChild(tile);
  }
}

function renderChecklist() {
  checklistEl.innerHTML = "";
  let done = 0;
  for (const r of ROLES) {
    const has = allCrops.some((c) => c.image_role === r.id);
    if (has && r.required) done++;
    const row = document.createElement("div");
    row.className = "snip-role-row" + (has ? " is-done" : "");
    row.innerHTML = `
      <span class="check">${has
        ? '<svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7l3 3 5-6"/></svg>'
        : ''}</span>
      <span class="swatch" style="--swatch:${r.swatch}"></span>
      ${escapeText(r.label)}${r.required ? '' : ' <span style="color: var(--snip-tertiary); font-size: 11px; margin-left: 4px;">(optional)</span>'}
      <span class="key">${r.key}</span>`;
    checklistEl.appendChild(row);
  }
  progressDone.textContent = String(done);
}

/* ─── Upload page render ─────────────────────────────────────────── */

async function uploadPageRender(file) {
  if (!file.type.match(/^image\/(jpeg|png)$/)) { toastError("JPEG or PNG only."); return; }
  if (file.size > 8 * 1024 * 1024)              { toastError("File too large (max 8 MB)."); return; }

  statusEl.textContent = "Reading…";
  const dataUrl = await readFile(file);
  const dims = await imageDimensions(dataUrl);

  statusEl.textContent = "Uploading…";
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

/* ─── Save crop ─────────────────────────────────────────────────── */

async function saveCrop(role) {
  if (!cropper || !currentRender) return;
  const data = cropper.getData(true);
  const w = Math.round(data.width), h = Math.round(data.height);
  if (w <= 0 || h <= 0) { toast("Drag a rectangle first.", "default"); return; }

  if (role === "main") {
    const existingMain = allCrops.find((c) => c.image_role === "main");
    if (existingMain) {
      const ok = await confirmDialog({
        title: "Replace existing main?",
        body: "There's already a main image. Save this as main and demote the previous one to extra?",
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
    setActionbarVisible(false);
    await loadAllCrops();
  } catch (err) {
    statusEl.textContent = "";
    if (err instanceof ApiError && err.code === "VALIDATION_FAILED") toast(err.message, "error");
  }
}

/* ─── Helpers ───────────────────────────────────────────────────── */

function readFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = (e) => resolve(e.target.result);
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
function escapeText(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(s) {
  return escapeText(s).replace(/"/g, "&quot;");
}
