// Groom types page — per-breed CRUD over Groom Profiles.

import { requireSession, wireLogoutLink } from "../auth.js";
import { api, ApiError } from "../api.js";
import { statusPill, toast, toastSuccess, formDialog, confirmDialog } from "../ui.js";
import { formatRelativeTime } from "../format.js";

if (!requireSession()) throw new Error("redirecting to login");
wireLogoutLink();

const params  = new URLSearchParams(location.search);
const breedId = params.get("breed_id");

const titleEl = document.getElementById("page-title");
const bodyEl  = document.getElementById("profiles-body");
const addBtn  = document.getElementById("add-button");

if (!breedId) {
  bodyEl.innerHTML = `<tr><td colspan="5" class="muted center">No breed selected.</td></tr>`;
  throw new Error("missing breed_id");
}

let breed = null;
let profiles = [];
let groomTypeVocab = [];

(async () => {
  await load();
  addBtn.addEventListener("click", onAdd);
})();

async function load() {
  bodyEl.innerHTML = `<tr><td colspan="5" class="muted center">Loading…</td></tr>`;
  try {
    const [breedData, gtData] = await Promise.all([
      api("get_breed_profile", { breed_id: breedId }),
      api("list_groom_types", { breed_id: breedId }),
    ]);
    breed = breedData.breed;
    groomTypeVocab = gtData.groom_types ?? [];

    titleEl.textContent = `${breed.breed_name} — groom types`;

    // Get all profiles for this breed by listing breeds-with-profiles is overkill;
    // instead we ask for a list of groom types with counts and use it to enumerate
    // profile_ids. The groom-types op returns counts but not profile_ids — we'll
    // show one row per groom_type and link it to whichever profile exists.
    // For now, render groom types with profile counts; clicking opens the profile.
    renderRows();
  } catch (err) {
    bodyEl.innerHTML = `<tr><td colspan="5" class="muted center">Failed to load.</td></tr>`;
  }
}

function renderRows() {
  bodyEl.innerHTML = "";
  if (groomTypeVocab.length === 0) {
    bodyEl.innerHTML = `<tr><td colspan="5" class="muted center">No groom types defined.</td></tr>`;
    return;
  }
  for (const gt of groomTypeVocab) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${escapeHtml(gt.name)}</strong></td>
      <td>${gt.published_count ? `<span class="pill pill--published">${gt.published_count} live</span>` : (gt.profile_count ? `<span class="pill pill--draft">${gt.profile_count} draft</span>` : `<span class="muted">—</span>`)}</td>
      <td><span class="muted">${gt.name === "Pet Groom" ? "(default candidate)" : ""}</span></td>
      <td class="col-hide-sm muted">—</td>
      <td>
        ${gt.profile_count > 0
          ? `<a class="btn btn--small btn--secondary" href="profile.html?breed_id=${encodeURIComponent(breedId)}&groom_type=${encodeURIComponent(gt.name)}">Open</a>`
          : `<button class="btn btn--small" type="button" data-action="create" data-groom-type="${escapeAttr(gt.name)}">Create</button>`}
      </td>`;
    bodyEl.appendChild(tr);
  }
  for (const btn of bodyEl.querySelectorAll("[data-action=create]")) {
    btn.addEventListener("click", () => createProfile(btn.dataset.groomType));
  }
}

async function createProfile(groomType) {
  try {
    const result = await api("create_profile", {
      breed_id: breedId,
      groom_type: groomType,
      source_type: "manual",
    });
    toastSuccess(`Created ${groomType} profile`);
    location.href = `profile.html?profile_id=${encodeURIComponent(result.profile_id)}`;
  } catch (err) {
    if (err instanceof ApiError && err.code === "VALIDATION_FAILED") {
      toast(err.message, "error");
    }
  }
}

async function onAdd() {
  const result = await formDialog({
    title: "Add groom type",
    fields: [
      { name: "groom_type", label: "Groom type name", type: "text", required: true },
    ],
    submitLabel: "Add",
  });
  if (!result) return;
  await createProfile(result.groom_type.trim());
}

function escapeHtml(s) { return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function escapeAttr(s) { return escapeHtml(s).replace(/"/g, "&quot;"); }
