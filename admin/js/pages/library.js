// Breed library page — search, filter, list, add new breed.

import { requireSession, wireLogoutLink } from "../auth.js";
import { api, ApiError } from "../api.js";
import { formatBreedType, formatRelativeTime, pluralise } from "../format.js";
import { formDialog, toast, toastSuccess } from "../ui.js";

if (!requireSession()) throw new Error("redirecting to login");
wireLogoutLink();

const tableBody    = document.getElementById("breed-table-body");
const searchInput  = document.getElementById("search");
const filterStatus = document.getElementById("filter-status");
const filterType   = document.getElementById("filter-type");
const newBtn       = document.getElementById("new-breed-button");

let allBreeds = [];

(async () => { await refresh(); })();

searchInput.addEventListener("input", debounce(applyFilters, 200));
filterStatus.addEventListener("change", applyFilters);
filterType.addEventListener("change", applyFilters);
newBtn.addEventListener("click", openNewBreedDialog);

async function refresh() {
  tableBody.innerHTML = `<tr><td colspan="4" class="muted center">Loading…</td></tr>`;
  try {
    const data = await api("list_breeds", {});
    allBreeds = data.breeds ?? [];
    applyFilters();
  } catch (err) {
    tableBody.innerHTML = `<tr><td colspan="4" class="muted center">Failed to load breeds.</td></tr>`;
  }
}

function applyFilters() {
  const q = searchInput.value.trim().toLowerCase();
  const wantStatus = filterStatus.value;
  const wantType = filterType.value;

  const filtered = allBreeds.filter((b) => {
    if (wantType && b.breed_type !== wantType) return false;
    // Status filter is per-profile; for the breed-level list we pass it through
    // to the API; here we filter on derived flags as a lightweight client filter.
    if (wantStatus === "Published" && !(b.published_count > 0)) return false;
    if (wantStatus === "Draft"     && !(b.profile_count > b.published_count)) return false;
    if (q) {
      const haystack = [
        b.breed_name,
        ...(b.alternative_names ?? []),
        ...(b.common_jotform_names ?? []),
      ].join(" ").toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="4" class="muted center">No breeds match.</td></tr>`;
    return;
  }

  tableBody.innerHTML = "";
  for (const b of filtered) {
    const tr = document.createElement("tr");
    tr.tabIndex = 0;
    tr.addEventListener("click", () => goToBreed(b));
    tr.addEventListener("keydown", (e) => { if (e.key === "Enter") goToBreed(b); });
    tr.innerHTML = `
      <td><strong>${escapeHtml(b.breed_name)}</strong></td>
      <td class="col-hide-sm">${formatBreedType(b.breed_type)}</td>
      <td>${pluralise(b.profile_count ?? 0, "profile")} · ${b.published_count ?? 0} live</td>
      <td class="col-hide-sm muted">${formatRelativeTime(b.last_updated)}</td>`;
    tableBody.appendChild(tr);
  }
}

function goToBreed(b) {
  // Library row click navigates to a breed-level view. With one published
  // profile this jumps straight there; otherwise it goes to a per-breed
  // groom-type manager.
  if (b.profile_count === 1) {
    location.href = `profile.html?breed_id=${encodeURIComponent(b.breed_id)}`;
  } else {
    location.href = `groom-types.html?breed_id=${encodeURIComponent(b.breed_id)}`;
  }
}

async function openNewBreedDialog() {
  const result = await formDialog({
    title: "Add new breed",
    fields: [
      { name: "breed_name", label: "Breed name", type: "text", required: true },
      { name: "breed_type", label: "Type", type: "select", required: true,
        options: [
          { value: "pure", label: "Pure breed" },
          { value: "cross", label: "Cross breed" },
        ] },
    ],
    submitLabel: "Add",
  });
  if (!result) return;

  try {
    await api("save_breed", {
      breed: {
        breed_name: result.breed_name.trim(),
        breed_type: result.breed_type,
      },
    });
    toastSuccess(`Added ${result.breed_name}`);
    await refresh();
  } catch (err) {
    if (err instanceof ApiError && err.code === "VALIDATION_FAILED") {
      toast(err.message ?? "Couldn't add breed", "error");
    }
  }
}

function debounce(fn, delay) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
