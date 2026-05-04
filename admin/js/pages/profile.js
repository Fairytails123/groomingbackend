// Profile editor — TEXT / IMAGES / DISPLAY / HISTORY tabs with debounced autosave.

import { requireSession, wireLogoutLink } from "../auth.js";
import { api, ApiError } from "../api.js";
import { statusPill, toast, toastError, toastSuccess, confirmDialog, formDialog } from "../ui.js";
import { formatRelativeTime } from "../format.js";
import { populateSidebarCounts } from "../sidebar.js";

// `formatRelativeTime` is also used by loadHistory below.

if (!requireSession()) throw new Error("redirecting to login");
wireLogoutLink();
populateSidebarCounts();

const params    = new URLSearchParams(location.search);
const profileId = params.get("profile_id");
const breedId   = params.get("breed_id");

const titleEl     = document.getElementById("page-title");
const subtitleEl  = document.getElementById("page-subtitle");
const statusEl    = document.getElementById("status-pill");
const saveEl     = document.getElementById("save-status");
const publishBtn  = document.getElementById("publish-button");
const backBtn     = document.getElementById("back-button");
const sectionsEl  = document.getElementById("sections-list");
const addBtn      = document.getElementById("add-section-button");
const notesEl     = document.getElementById("important-notes");
const splitInput  = document.getElementById("image-panel-width");
const splitDisplayEl = document.getElementById("split-display");
const fontSizeEl  = document.getElementById("font-size");
const themeEl     = document.getElementById("theme");
const showBladeEl = document.getElementById("show-blade-box");
const showWarnEl  = document.getElementById("show-warnings");
const defaultEl   = document.getElementById("default-profile");
const snipLink    = document.getElementById("open-snip-link");
const reextractBtn = document.getElementById("reextract-button");

const CORE_NAMES = new Set([
  "Body", "Throat and chest", "Carriage and tail end", "Legs and feet", "Head/ears/brows",
]);

let state = {
  profile: null,
  breed: null,
  sections: [],
  display: null,
};
let saveDebounce = null;
let savingInFlight = false;

backBtn.addEventListener("click", () => location.href = "library.html");

(async () => {
  // Tabs
  for (const tab of document.querySelectorAll(".tab")) {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  }

  await load();

  publishBtn.addEventListener("click", onPublish);
  addBtn.addEventListener("click", onAddSection);
  notesEl.addEventListener("input", scheduleSave);

  splitInput.addEventListener("input", () => {
    const w = Number(splitInput.value);
    splitDisplayEl.textContent = `${w}% / ${100 - w}%`;
    scheduleSave();
  });
  fontSizeEl.addEventListener("change", scheduleSave);
  themeEl.addEventListener("change", scheduleSave);
  showBladeEl.addEventListener("change", scheduleSave);
  showWarnEl.addEventListener("change", scheduleSave);
  defaultEl.addEventListener("change", scheduleSave);
})();

function switchTab(name) {
  for (const tab of document.querySelectorAll(".tab")) {
    const isActive = tab.dataset.tab === name;
    tab.classList.toggle("tab--active", isActive);
    tab.setAttribute("aria-selected", isActive);
  }
  for (const panel of document.querySelectorAll(".tab-panel")) {
    panel.hidden = panel.id !== `tab-${name}`;
  }
  if (name === "history") loadHistory();
}

async function loadImagesTab() {
  if (!state.profile) return;
  const pageEl = document.getElementById("page-renders-list");
  const pageCountEl = document.getElementById("page-render-count");
  const imagesEl = document.getElementById("images-list");
  const imageCountEl = document.getElementById("image-count");

  try {
    const [pages, images] = await Promise.all([
      api("list_page_renders", { profile_id: state.profile.profile_id }).catch(() => ({ page_renders: [] })),
      api("list_images",       { profile_id: state.profile.profile_id }).catch(() => ({ images: [] })),
    ]);

    const renders = pages.page_renders ?? [];
    const imgs = images.images ?? [];

    pageCountEl.textContent = renders.length === 0 ? "(none yet)" : `(${renders.length})`;
    if (renders.length === 0) {
      pageEl.innerHTML = `<p class="muted">No page renders yet. Click <strong>"Open snipping tool"</strong> above to add some.</p>`;
    } else {
      pageEl.style.display = "flex";
      pageEl.style.flexWrap = "wrap";
      pageEl.style.gap = "var(--space-2)";
      pageEl.innerHTML = "";
      for (const r of renders) {
        const tile = document.createElement("a");
        tile.href = `snip.html?profile_id=${encodeURIComponent(state.profile.profile_id)}`;
        tile.style.cssText = "display:inline-block; text-decoration:none; border:1px solid var(--color-border); border-radius:var(--radius-md); padding:var(--space-2); background:var(--color-surface); color:var(--color-text);";
        tile.innerHTML = `<div style="font-size:var(--font-size-xs); color:var(--color-text-muted);">Page ${r.page_index}</div><div style="font-size:var(--font-size-xs); font-family:var(--font-family-mono); color:var(--color-text-muted);">${r.width_px}×${r.height_px}</div>`;
        pageEl.appendChild(tile);
      }
    }

    imageCountEl.textContent = imgs.length === 0 ? "(none yet)" : `(${imgs.length})`;
    if (imgs.length === 0) {
      imagesEl.innerHTML = `<p class="muted">No cropped images yet.</p>`;
    } else {
      imagesEl.style.display = "flex";
      imagesEl.style.flexWrap = "wrap";
      imagesEl.style.gap = "var(--space-2)";
      imagesEl.innerHTML = "";
      for (const img of imgs) {
        const tile = document.createElement("div");
        tile.style.cssText = "display:inline-block; border:1px solid var(--color-border); border-radius:var(--radius-md); padding:var(--space-2); background:var(--color-surface); min-width:120px;";
        tile.innerHTML = `
          <div style="font-size:var(--font-size-xs); color:var(--color-brand-blue); font-weight:bold; text-transform:capitalize;">${escapeText(img.image_role)}</div>
          <div style="font-size:var(--font-size-xs); color:var(--color-text-muted); font-family:var(--font-family-mono);">${img.image_id}</div>`;
        imagesEl.appendChild(tile);
      }
    }
  } catch (err) {
    pageEl.innerHTML = `<p class="muted">Couldn't load page renders.</p>`;
    imagesEl.innerHTML = `<p class="muted">Couldn't load images.</p>`;
  }

  await loadPendingHeadings();
}

async function loadPendingHeadings() {
  if (!state.profile) return;
  const card = document.getElementById("pending-headings-card");
  const countEl = document.getElementById("pending-headings-count");
  const listEl = document.getElementById("pending-headings-list");
  if (!card || !listEl) return;

  try {
    const data = await api("list_pending_headings", { profile_id: state.profile.profile_id });
    const pending = data.pending ?? [];
    if (pending.length === 0) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    countEl.textContent = `(${pending.length})`;
    listEl.innerHTML = "";
    for (const p of pending) {
      const row = document.createElement("div");
      row.className = "pending-heading-row";
      row.style.cssText = "border:1px solid var(--color-border); border-radius:var(--radius-md); padding:var(--space-3); background:var(--color-surface); margin-bottom:var(--space-2);";
      row.innerHTML = `
        <div class="row row--space-between" style="flex-wrap:wrap; gap:var(--space-2); align-items:flex-start;">
          <div style="flex:1; min-width:240px;">
            <div style="font-weight:var(--font-weight-medium);">${escapeText(p.suggested_heading)}</div>
            ${p.ai_reason ? `<div class="muted" style="font-size:var(--font-size-sm);">${escapeText(p.ai_reason)}</div>` : ""}
            ${p.suggested_text ? `<details style="margin-top:var(--space-2);"><summary class="muted" style="cursor:pointer; font-size:var(--font-size-sm);">Show body text</summary><div style="margin-top:var(--space-2); white-space:pre-wrap; font-size:var(--font-size-sm);">${escapeText(p.suggested_text)}</div></details>` : ""}
          </div>
          <div class="row" style="gap:var(--space-2); flex-wrap:wrap;">
            <button class="btn btn--small" type="button" data-action="approve">Approve</button>
            <button class="btn btn--small btn--secondary" type="button" data-action="edit">Edit & approve</button>
            <button class="btn btn--small btn--secondary" type="button" data-action="ignore">Ignore</button>
          </div>
        </div>`;
      listEl.appendChild(row);
      row.querySelector('[data-action="approve"]').addEventListener("click", () => decidePending(p, "approve"));
      row.querySelector('[data-action="edit"]').addEventListener("click", () => decidePending(p, "edit_and_approve"));
      row.querySelector('[data-action="ignore"]').addEventListener("click", () => decidePending(p, "ignore"));
    }
  } catch (err) {
    listEl.innerHTML = `<p class="muted">Couldn't load pending headings.</p>`;
    card.hidden = false;
  }
}

async function decidePending(p, decision) {
  let payload = { approval_id: p.approval_id, decision };

  if (decision === "ignore") {
    const ok = await confirmDialog({
      title: `Ignore "${p.suggested_heading}"?`,
      body: `This won't add it to the profile. You can still re-extract later if you change your mind.`,
      confirmLabel: "Ignore",
    });
    if (!ok) return;
  } else if (decision === "edit_and_approve") {
    const result = await formDialog({
      title: "Edit & approve heading",
      submitLabel: "Approve",
      fields: [
        { name: "edited_heading", label: "Heading", type: "text", value: p.suggested_heading, required: true },
        { name: "edited_text", label: "Body text", type: "textarea", rows: 6, value: p.suggested_text },
      ],
    });
    if (!result) return;
    payload.edited_heading = result.edited_heading;
    payload.edited_text = result.edited_text;
  }

  try {
    const result = await api("decide_heading", payload);
    if (result.final_status === "approved") {
      toastSuccess(`Approved "${decision === "edit_and_approve" ? payload.edited_heading : p.suggested_heading}"`);
      // Reload the profile so the new section appears in TEXT tab next time it's rendered.
      await load();
    } else {
      toast("Heading ignored.", "default");
    }
    await loadPendingHeadings();
  } catch (err) {
    if (err instanceof ApiError && err.code === "CONFLICT") {
      toast("Already decided in another tab.", "default");
      await loadPendingHeadings();
    } else {
      toastError("Couldn't save decision.");
    }
  }
}

let historyLoaded = false;
async function loadHistory() {
  if (historyLoaded || !state.profile) return;
  historyLoaded = true;
  const listEl = document.getElementById("history-list");
  try {
    const data = await api("get_version_history", { profile_id: state.profile.profile_id, limit: 30 });
    const items = data.items ?? [];
    if (items.length === 0) {
      listEl.innerHTML = `<p class="muted">No history yet. Edits and publishes will land here.</p>`;
      return;
    }
    listEl.innerHTML = "";
    for (const v of items) {
      const row = document.createElement("div");
      row.style.padding = "var(--space-2) 0";
      row.style.borderBottom = "1px solid var(--color-border)";
      row.innerHTML = `
        <div class="row row--space-between">
          <div><strong>${escapeText(v.change_type)}</strong> <span class="muted">— ${escapeText(v.actor ?? "kamal")}</span></div>
          <span class="muted" style="font-size:var(--font-size-sm);">${formatRelativeTime(v.created_at)}</span>
        </div>
        ${v.reason ? `<div class="muted" style="font-size:var(--font-size-sm);">${escapeText(v.reason)}</div>` : ""}`;
      listEl.appendChild(row);
    }
  } catch {
    listEl.innerHTML = `<p class="muted">History unavailable.</p>`;
  }
}

async function load() {
  const body = profileId ? { profile_id: profileId } : { breed_id: breedId };
  try {
    const data = await api("get_breed_profile", body);
    state.profile = data.profile;
    state.breed = data.breed;
    state.sections = data.sections;
    state.display = data.display_settings;

    // If breed exists but no profile yet, prompt the user to create the first profile.
    if (!state.profile) {
      titleEl.textContent = data.breed.breed_name;
      subtitleEl.innerHTML = `<button class="btn btn--small" id="create-pet-groom-btn">Create Pet Groom profile</button>`;
      document.getElementById("create-pet-groom-btn").addEventListener("click", async () => {
        try {
          const result = await api("create_profile", {
            breed_id: data.breed.breed_id,
            groom_type: "Pet Groom",
            source_type: "manual",
          });
          location.search = `?profile_id=${encodeURIComponent(result.profile_id)}`;
        } catch {}
      });
      sectionsEl.innerHTML = `<p class="muted">No profile yet — click "Create Pet Groom profile" above.</p>`;
      return;
    }

    titleEl.textContent = `${data.breed.breed_name} / ${data.profile.groom_type}`;
    subtitleEl.textContent = data.profile.last_publish_succeeded_at
      ? `Last published ${formatRelativeTime(data.profile.last_publish_succeeded_at)}`
      : "Never published";

    statusEl.innerHTML = "";
    statusEl.appendChild(statusPill(data.profile.status));

    publishBtn.disabled = false;
    snipLink.href = `snip.html?profile_id=${encodeURIComponent(data.profile.profile_id)}`;
    if (reextractBtn) {
      reextractBtn.hidden = !data.profile.source_pdf_drive_id;
      reextractBtn.onclick = onReextract;
    }

    renderSections();
    renderDisplay();
    loadImagesTab();
  } catch (err) {
    sectionsEl.innerHTML = `<p class="muted">Failed to load profile.</p>`;
  }
}

function renderSections() {
  sectionsEl.innerHTML = "";
  if (state.sections.length === 0) {
    sectionsEl.innerHTML = `<p class="muted">No sections yet.</p>`;
    return;
  }

  // Important notes — single textarea, takes the union of all sections' important_notes.
  // For per-section notes we render them inside each section card; the top-level
  // textarea is for profile-level overall notes (rendered as section "Notes").
  notesEl.value = state.sections
    .filter((s) => s.important_notes)
    .map((s) => `[${s.section_name}] ${s.important_notes}`)
    .join("\n\n");

  state.sections.forEach((section, idx) => {
    const div = document.createElement("div");
    div.className = "section";
    div.dataset.index = idx;
    const isCore = CORE_NAMES.has(section.section_name);

    div.innerHTML = `
      <div class="section__header">
        <input class="section__name-input" type="text" data-field="section_name"
               value="${escapeAttr(section.section_name)}" ${isCore ? "readonly" : ""}>
        <div class="section__order">
          <button type="button" data-action="up"   title="Move up"   ${idx === 0 ? "disabled" : ""}>↑</button>
          <button type="button" data-action="down" title="Move down" ${idx === state.sections.length - 1 ? "disabled" : ""}>↓</button>
        </div>
        ${isCore ? "" : `<button type="button" class="section__delete" data-action="delete" title="Delete section">✕</button>`}
      </div>
      <textarea class="section__textarea" data-field="section_text"
                placeholder="Trim, blade, technique notes for this section…">${escapeText(section.section_text)}</textarea>
      <div class="blade-row">
        <span class="muted" style="font-size:var(--font-size-sm);">Blades:</span>
        <span class="blade-pills" data-field="blade_numbers"></span>
        <input type="text" placeholder="#7F" data-action="add-blade">
      </div>
      <div class="section__notes">
        <label>Important notes for this section</label>
        <textarea data-field="important_notes" placeholder="Warnings, breed-specific tweaks…">${escapeText(section.important_notes)}</textarea>
      </div>`;
    sectionsEl.appendChild(div);

    renderBladePills(div.querySelector("[data-field=blade_numbers]"), section.blade_numbers ?? [], idx);

    // Field-change listeners
    div.querySelector("[data-field=section_text]").addEventListener("input", (e) => {
      state.sections[idx].section_text = e.target.value;
      scheduleSave();
    });
    div.querySelector("[data-field=section_name]").addEventListener("input", (e) => {
      state.sections[idx].section_name = e.target.value;
      scheduleSave();
    });
    div.querySelector("[data-field=important_notes]").addEventListener("input", (e) => {
      state.sections[idx].important_notes = e.target.value;
      scheduleSave();
    });
    const addBladeInput = div.querySelector("[data-action=add-blade]");
    addBladeInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const v = addBladeInput.value.trim();
        if (v) {
          state.sections[idx].blade_numbers.push(normaliseBlade(v));
          addBladeInput.value = "";
          renderBladePills(div.querySelector("[data-field=blade_numbers]"), state.sections[idx].blade_numbers, idx);
          scheduleSave();
        }
      }
    });

    div.querySelector("[data-action=up]")?.addEventListener("click", () => moveSection(idx, -1));
    div.querySelector("[data-action=down]")?.addEventListener("click", () => moveSection(idx, +1));
    div.querySelector("[data-action=delete]")?.addEventListener("click", async () => {
      const ok = await confirmDialog({
        title: "Delete section?",
        body: `Remove "${state.sections[idx].section_name}"? Section text will be lost.`,
        confirmLabel: "Delete",
        danger: true,
      });
      if (ok) {
        state.sections.splice(idx, 1);
        renderSections();
        scheduleSave();
      }
    });
  });
}

function renderBladePills(container, blades, sectionIdx) {
  container.innerHTML = "";
  for (const [pillIdx, blade] of blades.entries()) {
    const pill = document.createElement("span");
    pill.className = "blade-pill";
    pill.innerHTML = `${escapeText(blade)} <button type="button" aria-label="Remove ${escapeAttr(blade)}">×</button>`;
    pill.querySelector("button").addEventListener("click", () => {
      state.sections[sectionIdx].blade_numbers.splice(pillIdx, 1);
      renderBladePills(container, state.sections[sectionIdx].blade_numbers, sectionIdx);
      scheduleSave();
    });
    container.appendChild(pill);
  }
}

function normaliseBlade(s) {
  s = s.trim();
  if (!s.startsWith("#")) s = "#" + s;
  return s.toUpperCase();
}

function moveSection(idx, delta) {
  const target = idx + delta;
  if (target < 0 || target >= state.sections.length) return;
  const tmp = state.sections[idx];
  state.sections[idx] = state.sections[target];
  state.sections[target] = tmp;
  renderSections();
  scheduleSave();
}

async function onAddSection() {
  state.sections.push({
    section_id: null,
    section_name: "New section",
    section_order: state.sections.length + 1,
    section_text: "",
    blade_numbers: [],
    important_notes: "",
    approved: false,
  });
  renderSections();
  scheduleSave();
}

function renderDisplay() {
  if (!state.display) return;
  splitInput.value = state.display.image_panel_width;
  splitDisplayEl.textContent = `${state.display.image_panel_width}% / ${100 - state.display.image_panel_width}%`;
  fontSizeEl.value = state.display.font_size;
  themeEl.value = state.display.theme;
  showBladeEl.checked = state.display.show_blade_box;
  showWarnEl.checked = state.display.show_warnings;
  defaultEl.checked = !!state.profile?.default_profile;
}

function scheduleSave() {
  if (saveDebounce) clearTimeout(saveDebounce);
  saveEl.textContent = "Editing…";
  saveDebounce = setTimeout(saveNow, 1500);
}

async function saveNow() {
  if (!state.profile) return;
  if (savingInFlight) return;
  savingInFlight = true;
  saveEl.textContent = "Saving…";

  const w = Number(splitInput.value);
  const patch = {
    sections: state.sections.map((s, i) => ({
      section_id: s.section_id,
      section_name: s.section_name,
      section_order: i + 1,
      section_text: s.section_text,
      blade_numbers: s.blade_numbers,
      important_notes: s.important_notes,
      approved: s.approved,
    })),
    display_settings: {
      image_panel_width: w,
      text_panel_width: 100 - w,
      main_image_id: state.display?.main_image_id ?? null,
      supplementary_order: state.display?.supplementary_order ?? [],
      font_size: fontSizeEl.value,
      show_blade_box: showBladeEl.checked,
      show_warnings: showWarnEl.checked,
      theme: themeEl.value,
    },
    default_profile: defaultEl.checked,
  };

  try {
    const result = await api("save_profile", {
      profile_id: state.profile.profile_id,
      expected_version: state.profile.current_version,
      patch,
    });
    state.profile.current_version = result.current_version;
    saveEl.textContent = "Saved ✓";
    setTimeout(() => { if (saveEl.textContent === "Saved ✓") saveEl.textContent = ""; }, 2500);
    // If save flipped Published → Draft, refresh status pill.
    if (state.profile.status === "Published") {
      state.profile.status = "Draft";
      statusEl.innerHTML = "";
      statusEl.appendChild(statusPill("Draft"));
    }
  } catch (err) {
    if (err instanceof ApiError && err.code === "CONFLICT") {
      const ok = await confirmDialog({
        title: "Edited elsewhere",
        body: "This profile was changed in another tab. Reload to pull the latest, or continue overwriting?",
        confirmLabel: "Reload",
      });
      if (ok) location.reload();
    } else {
      saveEl.textContent = "";
      toastError("Save failed");
    }
  } finally {
    savingInFlight = false;
  }
}

async function onReextract() {
  if (!state.profile?.source_pdf_drive_id) return;
  const ok = await confirmDialog({
    title: "Re-extract from PDF?",
    body: "This re-runs AI extraction on the existing PDF. Core sections will be overwritten with fresh AI output (manual edits to Body/Throat/Carriage/Legs/Head will be lost — version history captures them). Vision findings are upserted in place. OK to continue?",
    confirmLabel: "Re-extract",
  });
  if (!ok) return;

  reextractBtn.disabled = true;
  reextractBtn.textContent = "Fetching PDF…";
  try {
    const result = await api("get_source_pdf", { profile_id: state.profile.profile_id }, { timeoutMs: 120000 });
    sessionStorage.setItem("ft_reextract_pdf_b64", result.pdf_blob_b64);
    sessionStorage.setItem("ft_reextract_filename", result.original_filename ?? "source.pdf");
    sessionStorage.setItem("ft_reextract_profile_id", state.profile.profile_id);
    location.href = "upload.html?reextract=1";
  } catch (err) {
    reextractBtn.disabled = false;
    reextractBtn.textContent = "Re-extract sections";
    if (err instanceof ApiError) {
      toastError(err.message);
    } else {
      toastError("Couldn't fetch source PDF.");
    }
  }
}

async function onPublish() {
  if (!state.profile) return;

  // 1) Flush any pending edits first so we publish the latest version.
  if (saveDebounce) { clearTimeout(saveDebounce); saveDebounce = null; }
  await saveNow();

  // 2) Confirm with the user.
  const breedName = state.breed && state.breed.breed_name ? state.breed.breed_name : "";
  const groomType = state.profile.groom_type || "";
  const ok = await confirmDialog({
    title: "Publish profile?",
    body: "This pushes the current draft of " + breedName + " / " + groomType + " to GitHub Pages so the TV display can pick it up.",
    confirmLabel: "Publish",
  });
  if (!ok) return;

  const originalLabel = publishBtn.textContent;
  publishBtn.disabled = true;
  publishBtn.textContent = "Publishing...";
  saveEl.textContent = "Publishing...";

  try {
    const result = await api(
      "publish_profile",
      {
        profile_id: state.profile.profile_id,
        expected_version: state.profile.current_version,
      },
      { timeoutMs: 120000 },
    );
    const imgs = result.images_pushed != null ? result.images_pushed : 0;
    toastSuccess("Published \u2014 " + imgs + " image(s) pushed.");
    saveEl.textContent = "";
    await load();
  } catch (err) {
    saveEl.textContent = "";
    if (err instanceof ApiError && err.code === "VALIDATION_FAILED") {
      toastError(err.message || "Profile failed validation \u2014 fix issues and try again.");
    } else if (err instanceof ApiError && err.code === "GITHUB_FAILED") {
      toastError("GitHub push failed \u2014 check GITHUB_PAT in Apps Script Properties.");
    } else if (err instanceof ApiError && err.code === "CONFLICT") {
      const reload = await confirmDialog({
        title: "Edited elsewhere",
        body: "This profile was changed in another tab since the last save. Reload to pull the latest?",
        confirmLabel: "Reload",
      });
      if (reload) location.reload();
    } else if (err instanceof ApiError) {
      toastError(err.message || "Publish failed.");
    } else {
      toastError("Publish failed \u2014 please try again.");
    }
  } finally {
    publishBtn.disabled = false;
    publishBtn.textContent = originalLabel || "Publish";
  }
}

function escapeText(s) { return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function escapeAttr(s) { return escapeText(s).replace(/"/g, "&quot;"); }
