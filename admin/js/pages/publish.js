// Private TV release page — reconcile backend profile state with a verified,
// already-deployed PIN-hosted release. No book content is pushed to GitHub.

import { requireSession, wireLogoutLink } from "../auth.js";
import { api, ApiError } from "../api.js";
import { statusPill, toast, toastSuccess, confirmDialog } from "../ui.js";
import { formatRelativeTime } from "../format.js";
import { populateSidebarCounts } from "../sidebar.js";

if (!requireSession()) throw new Error("redirecting to login");
wireLogoutLink();
populateSidebarCounts();

const tbody = document.getElementById("drafts-body");
const releaseSummary = document.getElementById("release-summary");
const releaseFile = document.getElementById("release-file");
const releaseFileName = document.getElementById("release-file-name");
const registerButton = document.getElementById("register-release");

let selectedRelease = null;

(async () => { await refreshAll(); })();

releaseFile.addEventListener("change", async () => {
  selectedRelease = null;
  registerButton.disabled = true;
  const file = releaseFile.files?.[0];
  if (!file) {
    releaseFileName.textContent = "Choose a release-registration JSON file.";
    return;
  }
  try {
    const parsed = JSON.parse(await file.text());
    const release = parsed.release ?? parsed;
    if (!release.release_id || !release.manifest_sha256 || !release.breed_pack_sha256) {
      throw new Error("Required release fields are missing");
    }
    selectedRelease = release;
    registerButton.disabled = false;
    releaseFileName.textContent = `${file.name} · ${Number(release.breed_count ?? 0)} breeds · ${String(release.release_id)}`;
  } catch (err) {
    releaseFileName.textContent = "This is not a valid private-TV release registration file.";
    toast(err.message || "Invalid release file.", "error");
  }
});

registerButton.addEventListener("click", async () => {
  if (!selectedRelease) return;
  const confirmed = await confirmDialog({
    title: "Register verified private TV release?",
    body: `This will mark the approved profiles contained in ${selectedRelease.release_id} as Published on the protected salon TV. It will not upload book content to public GitHub Pages.`,
    confirmLabel: "Register release",
  });
  if (!confirmed) return;

  registerButton.disabled = true;
  registerButton.textContent = "Reconciling…";
  try {
    const result = await api("register_private_tv_release", { release: selectedRelease }, { timeoutMs: 120000 });
    toastSuccess(`Private TV release registered · ${result.profiles_transitioned} profile(s) updated.`);
    selectedRelease = null;
    releaseFile.value = "";
    releaseFileName.textContent = "Choose a release-registration JSON file.";
    await refreshAll();
    await populateSidebarCounts();
  } catch (err) {
    if (err instanceof ApiError) toast(err.message, "error");
    else toast("Private TV release registration failed.", "error");
  } finally {
    registerButton.disabled = !selectedRelease;
    registerButton.textContent = "Register verified release";
  }
});

async function refreshAll() {
  await Promise.all([refreshReleaseStatus(), refreshPendingProfiles()]);
}

async function refreshReleaseStatus() {
  releaseSummary.textContent = "Loading release status…";
  try {
    const data = await api("private_tv_release_status");
    if (!data.registered) {
      releaseSummary.textContent = "No private TV release has been registered in the backend yet.";
      return;
    }
    const when = data.last_reconciled_at ? formatRelativeTime(data.last_reconciled_at) : "unknown time";
    releaseSummary.textContent = `${data.release_id} · ${data.breed_count} breeds · ${data.section_count} sections · ${data.image_count} images · reconciled ${when}`;
  } catch {
    releaseSummary.textContent = "Couldn't load private TV release status.";
  }
}

async function refreshPendingProfiles() {
  tbody.innerHTML = `<tr><td colspan="4" class="muted center">Loading pending profiles…</td></tr>`;
  try {
    const data = await api("list_drafts");
    const drafts = data.drafts ?? [];
    if (drafts.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="muted center">All profiles are reconciled with the current private TV release.</td></tr>`;
      return;
    }
    tbody.innerHTML = "";
    for (const draft of drafts) {
      const isReference = draft.source_type === "reference-catalog";
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>
          <a href="profile.html?profile_id=${encodeURIComponent(draft.profile_id)}"><strong>${escapeText(draft.breed_name)}</strong> / ${escapeText(draft.groom_type)}</a>
        </td>
        <td></td>
        <td class="col-hide-sm muted">${formatRelativeTime(draft.updated_at)}</td>
        <td class="muted">${isReference ? "Awaiting verified private release" : "Legacy public publishing disabled"}</td>`;
      tr.querySelector("td:nth-child(2)").appendChild(statusPill(draft.status));
      tbody.appendChild(tr);
    }
  } catch {
    tbody.innerHTML = `<tr><td colspan="4" class="muted center">Couldn't load pending profiles.</td></tr>`;
  }
}

function escapeText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
