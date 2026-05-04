// Publish page — list drafts, click Publish per row.

import { requireSession, wireLogoutLink } from "../auth.js";
import { api, ApiError } from "../api.js";
import { statusPill, toast, toastSuccess, confirmDialog } from "../ui.js";
import { formatRelativeTime } from "../format.js";
import { populateSidebarCounts } from "../sidebar.js";

if (!requireSession()) throw new Error("redirecting to login");
wireLogoutLink();
populateSidebarCounts();

const tbody = document.getElementById("drafts-body");

(async () => { await refresh(); })();

async function refresh() {
  tbody.innerHTML = `<tr><td colspan="4" class="muted center">Loading…</td></tr>`;
  try {
    const data = await api("list_drafts");
    const drafts = data.drafts ?? [];
    if (drafts.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="muted center">No drafts to publish.</td></tr>`;
      return;
    }
    tbody.innerHTML = "";
    for (const d of drafts) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>
          <a href="profile.html?profile_id=${encodeURIComponent(d.profile_id)}"><strong>${escapeText(d.breed_name)}</strong> / ${escapeText(d.groom_type)}</a>
        </td>
        <td></td>
        <td class="col-hide-sm muted">${formatRelativeTime(d.updated_at)}</td>
        <td>
          <button class="btn btn--small" type="button" data-id="${escapeAttr(d.profile_id)}" data-version="${d.current_version}">Publish</button>
        </td>`;
      tr.querySelector("td:nth-child(2)").appendChild(statusPill(d.status));
      tr.querySelector("button").addEventListener("click", async (e) => {
        e.preventDefault();
        const btn = e.currentTarget;
        btn.disabled = true; btn.textContent = "Publishing…";
        try {
          const result = await api("publish_profile", {
            profile_id: d.profile_id,
            expected_version: d.current_version,
          });
          toastSuccess(`Published — ${result.images_pushed} image(s) pushed.`);
          await refresh();
        } catch (err) {
          if (err instanceof ApiError && err.code === "VALIDATION_FAILED") {
            toast(err.message, "error");
          } else if (err instanceof ApiError && err.code === "GITHUB_FAILED") {
            toast("GitHub push failed — check GITHUB_PAT in Apps Script Properties.", "error");
          }
        } finally {
          btn.disabled = false; btn.textContent = "Publish";
        }
      });
      tbody.appendChild(tr);
    }
  } catch {
    tbody.innerHTML = `<tr><td colspan="4" class="muted center">Couldn't load drafts.</td></tr>`;
  }
}

function escapeText(s) { return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function escapeAttr(s) { return escapeText(s).replace(/"/g, "&quot;"); }
