import { requireSession, wireLogoutLink } from "../auth.js";
import { api, ApiError } from "../api.js";
import { toast, toastSuccess } from "../ui.js";

if (!requireSession()) throw new Error("redirecting to login");
wireLogoutLink();

const summaryEl = document.getElementById("reference-summary");
const tableEl = document.getElementById("reference-table");
const detailEl = document.getElementById("reference-detail");
const searchEl = document.getElementById("reference-search");
const statusEl = document.getElementById("reference-status");
const recordFilesEl = document.getElementById("record-files");
const catalogVisualFilesEl = document.getElementById("catalog-visual-files");
const createApprovedProfilesEl = document.getElementById("create-approved-profiles");
const progressEl = document.getElementById("import-progress");

let entries = [];
let selectedEntry = null;
let selectedRecord = null;

searchEl.addEventListener("input", debounce(loadEntries, 250));
statusEl.addEventListener("change", loadEntries);
recordFilesEl.addEventListener("change", () => importRecords([...recordFilesEl.files]));
catalogVisualFilesEl.addEventListener("change", () => importCatalogVisuals([...catalogVisualFilesEl.files]));
createApprovedProfilesEl.addEventListener("click", createApprovedProfiles);
detailEl.addEventListener("click", handleDetailClick);

await loadSummary(true);
await loadEntries();
const requestedEntryId = new URLSearchParams(location.search).get("entry");
if (requestedEntryId) await openEntry(requestedEntryId);

async function loadSummary(initializeIfMissing = false) {
  try {
    const status = await api("reference_catalog_status", {});
    const needsReview = Object.entries(status.review_status_counts ?? {})
      .filter(([name]) => name !== "approved")
      .reduce((sum, [, value]) => sum + Number(value), 0);
    summaryEl.innerHTML = [
      stat(status.total_entries, "Catalogue entries"),
      stat(needsReview, "Need review"),
      stat(status.ready_for_profile_creation, "Ready for profile"),
      stat(status.linked_profiles, "Profiles created"),
    ].join("");
  } catch {
    if (initializeIfMissing) {
      try {
        await api("ensure_reference_catalog_schema", {}, { timeoutMs: 120000 });
        return await loadSummary(false);
      } catch (error) {
        console.error("Reference schema initialization failed", error);
      }
    }
    summaryEl.innerHTML = `<p class="muted">Reference sheets are unavailable. Run the idempotent setup after deploying this code.</p>`;
  }
}

async function loadEntries() {
  tableEl.innerHTML = `<tr><td colspan="4" class="muted center">Loading…</td></tr>`;
  try {
    const data = await api("search_reference_entries", {
      query: searchEl.value.trim(),
      review_status: statusEl.value,
      limit: 250,
    });
    entries = data.entries ?? [];
    renderEntries();
  } catch {
    tableEl.innerHTML = `<tr><td colspan="4" class="muted center">Could not load reference entries.</td></tr>`;
  }
}

function renderEntries() {
  if (!entries.length) {
    tableEl.innerHTML = `<tr><td colspan="4" class="muted center">No reference entries match.</td></tr>`;
    return;
  }
  tableEl.innerHTML = entries.map((entry) => `
    <tr class="reference-row" data-entry-id="${escapeHtml(entry.reference_entry_id)}"
        aria-current="${selectedEntry?.reference_entry_id === entry.reference_entry_id}">
      <td><strong>${escapeHtml(entry.breed_name)}</strong><br><span class="muted">${escapeHtml(entry.group_name)}</span></td>
      <td>${escapeHtml(entry.source_status)}</td>
      <td>${escapeHtml(entry.review_status)}</td>
      <td>${entry.high_risk_verified}/${entry.high_risk_total}</td>
    </tr>`).join("");
  tableEl.querySelectorAll("[data-entry-id]").forEach((row) => {
    row.addEventListener("click", () => openEntry(row.dataset.entryId));
  });
}

async function importRecords(files) {
  const jsonFiles = files.filter((file) => file.name.toLowerCase().endsWith(".json"));
  if (!jsonFiles.length) return;
  recordFilesEl.disabled = true;
  let imported = 0;
  let failed = 0;
  for (let index = 0; index < jsonFiles.length; index++) {
    const file = jsonFiles[index];
    progressEl.textContent = `Importing ${index + 1}/${jsonFiles.length}: ${file.name}`;
    try {
      const record = JSON.parse(await file.text());
      await api("import_reference_entry", { record }, { timeoutMs: 120000 });
      imported++;
    } catch (error) {
      failed++;
      console.error("Reference import failed", file.name, error);
    }
  }
  progressEl.textContent = `${imported} imported${failed ? `, ${failed} failed` : ""}.`;
  recordFilesEl.disabled = false;
  recordFilesEl.value = "";
  if (failed) toast(`${failed} reference records failed validation`, "error");
  else toastSuccess(`Imported ${imported} reference records`);
  await Promise.all([loadSummary(), loadEntries()]);
}

async function createApprovedProfiles() {
  createApprovedProfilesEl.disabled = true;
  let created = 0;
  let skipped = 0;
  let failed = 0;
  try {
    const data = await api("search_reference_entries", { review_status: "approved", limit: 250 });
    const pending = (data.entries ?? []).filter((entry) => !entry.profile_id);
    for (let index = 0; index < pending.length; index++) {
      const entry = pending[index];
      progressEl.textContent = `Creating draft ${index + 1}/${pending.length}: ${entry.breed_name}`;
      try {
        const result = await api("create_profile_from_reference", {
          reference_entry_id: entry.reference_entry_id,
        }, { timeoutMs: 120000 });
        if (result.unchanged) skipped++;
        else created++;
      } catch (error) {
        if (error instanceof ApiError && error.code === "CONFLICT") skipped++;
        else failed++;
      }
    }
    progressEl.textContent = `${created} drafts created, ${skipped} existing/conflicting, ${failed} failed.`;
    if (failed) toast(`${failed} approved entries could not create drafts`, "error");
    else toastSuccess(`Created ${created} Pet Groom drafts`);
    await Promise.all([loadSummary(), loadEntries()]);
  } finally {
    createApprovedProfilesEl.disabled = false;
  }
}

async function importCatalogVisuals(files) {
  const byName = new Map(files.map((file) => [file.name.toLowerCase(), file]));
  if (!byName.size) return;
  catalogVisualFilesEl.disabled = true;
  let imported = 0;
  let failed = 0;
  try {
    const data = await api("search_reference_entries", { limit: 250 });
    const catalogueEntries = data.entries ?? [];
    for (let entryIndex = 0; entryIndex < catalogueEntries.length; entryIndex++) {
      const entry = catalogueEntries[entryIndex];
      progressEl.textContent = `Matching visuals ${entryIndex + 1}/${catalogueEntries.length}: ${entry.breed_name}`;
      const detail = await api("get_reference_entry", { reference_entry_id: entry.reference_entry_id }, { timeoutMs: 120000 });
      const variants = (detail.record.visual_references ?? []).flatMap((visual) => {
        const items = [];
        if (visual.browser_master_file) items.push({ visual, variant: "master", path: visual.browser_master_file });
        if (visual.enhanced_derivative?.file) items.push({ visual, variant: "enhanced", path: visual.enhanced_derivative.file });
        return items;
      });
      for (const item of variants) {
        const filename = item.path.split("/").pop().toLowerCase();
        const file = byName.get(filename);
        if (!file) continue;
        try {
          await api("import_reference_visual", {
            reference_entry_id: entry.reference_entry_id,
            asset_id: item.visual.asset_id,
            variant: item.variant,
            data_url: await fileToDataUrl(file),
          }, { timeoutMs: 120000 });
          imported++;
        } catch (error) {
          failed++;
          console.error("Reference visual import failed", entry.breed_name, filename, error);
        }
      }
    }
    progressEl.textContent = `${imported} private visuals imported${failed ? `, ${failed} failed` : ""}.`;
    if (failed) toast(`${failed} visual files failed hash validation or upload`, "error");
    else toastSuccess(`Imported ${imported} private visual assets`);
    if (selectedEntry) await openEntry(selectedEntry.reference_entry_id);
  } finally {
    catalogVisualFilesEl.disabled = false;
    catalogVisualFilesEl.value = "";
  }
}

async function openEntry(referenceEntryId) {
  detailEl.innerHTML = `<p class="muted center">Loading reference entry…</p>`;
  try {
    const data = await api("get_reference_entry", { reference_entry_id: referenceEntryId }, { timeoutMs: 120000 });
    selectedEntry = data.entry;
    selectedRecord = data.record;
    renderEntries();
    renderDetail();
  } catch {
    detailEl.innerHTML = `<p class="muted center">Could not load this reference entry.</p>`;
  }
}

function renderDetail() {
  const record = selectedRecord;
  const entry = selectedEntry;
  const supplements = (record.external_supplements ?? []).flatMap((item) => item.sources ?? []);
  detailEl.innerHTML = `
    <div class="reference-detail__header">
      <div><h2>${escapeHtml(record.breed.name)}</h2><p class="muted">${escapeHtml(record.breed.group)}</p></div>
      <div class="reference-badges">
        <span class="reference-badge">${escapeHtml(entry.review_status)}</span>
        <span class="reference-badge">PDF ${escapeHtml(record.breed.source_pdf_pages.join(", ") || "source gap")}</span>
      </div>
    </div>
    ${record.source.missing_printed_pages?.length ? `<div class="reference-risk"><strong>Source gap:</strong> printed pages ${escapeHtml(record.source.missing_printed_pages.join(", "))} are absent. External supplements are attributed separately.</div>` : ""}
    <h3>Breed facts</h3>
    <div>${Object.entries(record.facts ?? {}).map(([key, fact]) => renderFact(key, fact)).join("")}</div>
    ${supplements.length ? `<h3>External supplement sources</h3><ul>${supplements.map((source) => `<li><a href="${safeUrl(source.url)}" target="_blank" rel="noopener">${escapeHtml(source.authority)} — ${escapeHtml(source.title)}</a></li>`).join("")}</ul>` : ""}
    <h3>Editorial sections</h3>
    <p class="muted">Rewrite and verify against the source pages. Raw OCR cannot be approved as-is.</p>
    <div id="reference-sections">${(record.sections ?? []).map(renderSection).join("")}</div>
    <h3>High-risk verification</h3>
    <p class="muted">Resolve every blade specification, label/number and grooming boundary. Use “OCR error” only after checking the source image.</p>
    <div id="reference-risks">${(record.high_risk_review_queue ?? []).map(renderRisk).join("")}</div>
    <h3>Exact visual masters</h3>
    <p class="muted">Private visual references only. Exact masters remain authoritative; conservative enhanced derivatives are labelled separately and never replace them.</p>
    <div class="reference-actions">
      <label class="btn btn--secondary" for="visual-files">Import this breed's private PNG references</label>
      <input id="visual-files" class="visually-hidden" type="file" accept="image/png" multiple>
    </div>
    <div id="reference-visuals">${(record.visual_references ?? []).map(renderVisual).join("")}</div>
    <div class="reference-actions">
      <button class="btn btn--secondary" data-action="save-review">Save review</button>
      <button class="btn" data-action="approve-review">Approve resolved entry</button>
      ${entry.review_status === "approved" ? `<button class="btn" data-action="create-profile">Create Pet Groom draft</button>` : ""}
    </div>`;
  document.getElementById("visual-files")?.addEventListener("change", (event) => importVisuals([...event.target.files]));
}

function renderFact(key, fact) {
  const value = fact.verified_value ?? fact.value ?? "Missing";
  return `<div class="reference-fact"><strong>${escapeHtml(humanize(key))}</strong><div>${escapeHtml(value)}</div><span class="muted">${escapeHtml(fact.verification_status)}</span></div>`;
}

function renderSection(section) {
  return `<article class="reference-section" data-section-key="${escapeHtml(section.section_key)}">
    <label><strong>${escapeHtml(section.section_name)}</strong> — source PDF pages ${escapeHtml((section.source_pdf_pages ?? []).join(", "))}</label>
    <details><summary>Show OCR evidence</summary><pre class="reference-source-text">${escapeHtml(section.ocr_combined_text)}</pre></details>
    <textarea data-field="editorial-text" placeholder="Verified, groomer-ready wording…">${escapeHtml(section.editorial_text ?? "")}</textarea>
    <label><input type="checkbox" data-field="section-approved" ${section.approved ? "checked" : ""}> Editorial text checked against source</label>
  </article>`;
}

function renderRisk(item) {
  const resolved = ["verified_from_source_image", "externally_verified", "externally_verified_product_reference", "not_applicable", "rejected_as_ocr_error"].includes(item.verification_status);
  return `<article class="reference-risk" data-risk-id="${escapeHtml(item.review_id)}">
    <strong>${escapeHtml(humanize(item.kind))}</strong> · PDF ${item.source_pdf_page} / printed ${item.source_printed_page ?? "?"}
    <div class="reference-risk__context">${escapeHtml(item.context)}</div>
    <input data-field="risk-value" value="${escapeHtml(formatValue(item.verified_value))}" placeholder="Verified value or finding">
    <select data-field="risk-status">
      ${riskOption("needs_visual_review", "Needs visual review", item.verification_status)}
      ${riskOption("verified_from_source_image", "Verified from source image", item.verification_status)}
      ${riskOption("externally_verified", "Verified from authoritative source", item.verification_status)}
      ${riskOption("not_applicable", "Not applicable", item.verification_status)}
      ${riskOption("rejected_as_ocr_error", "Rejected as OCR error", item.verification_status)}
    </select>
    <textarea data-field="risk-notes" rows="2" placeholder="Verification notes">${escapeHtml(item.review_notes ?? "")}</textarea>
    ${resolved ? `<span class="reference-badge">Resolved</span>` : ""}
  </article>`;
}

function renderVisual(visual) {
  const enhanced = visual.enhanced_derivative;
  return `<article class="reference-visual" data-asset-id="${escapeHtml(visual.asset_id)}">
    <strong>PDF ${visual.source_pdf_page} / printed ${visual.source_printed_page ?? "?"}</strong>
    <div class="muted">${escapeHtml(visual.browser_master_integrity ?? visual.content_integrity)}</div>
    <code>${escapeHtml(visual.browser_master_encoded_sha256 ?? visual.master_encoded_sha256)}</code>
    <div class="reference-actions">
      <button class="btn btn--secondary" data-action="load-visual" data-variant="master" ${visual.drive_file_id ? "" : "disabled"}>View exact master</button>
      ${enhanced ? `<button class="btn btn--secondary" data-action="load-visual" data-variant="enhanced" ${enhanced.drive_file_id ? "" : "disabled"}>View enhanced derivative</button>` : ""}
    </div>
    ${enhanced ? `<div class="muted">Enhanced derivative: ${escapeHtml(enhanced.geometry_policy)}. ${escapeHtml(enhanced.recipe)}</div>` : ""}
    <div data-visual-target></div>
  </article>`;
}

async function handleDetailClick(event) {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  if (action === "save-review") await saveReview(false);
  if (action === "approve-review") await saveReview(true);
  if (action === "create-profile") await createProfile();
  if (action === "load-visual") await loadVisual(event.target.closest("[data-asset-id]"), event.target.dataset.variant);
}

async function saveReview(approve) {
  const sections = [...detailEl.querySelectorAll("[data-section-key]")].map((node) => ({
    section_key: node.dataset.sectionKey,
    editorial_text: node.querySelector("[data-field=editorial-text]").value,
    approved: node.querySelector("[data-field=section-approved]").checked,
  }));
  const highRiskItems = [...detailEl.querySelectorAll("[data-risk-id]")].map((node) => ({
    review_id: node.dataset.riskId,
    verified_value: node.querySelector("[data-field=risk-value]").value.trim(),
    verification_status: node.querySelector("[data-field=risk-status]").value,
    review_notes: node.querySelector("[data-field=risk-notes]").value.trim(),
    verification_source: { kind: "admin_review", reviewed_at: new Date().toISOString() },
  }));
  try {
    await api("save_reference_review", {
      reference_entry_id: selectedEntry.reference_entry_id,
      expected_revision: selectedEntry.revision,
      patch: { sections, high_risk_items: highRiskItems },
      approve,
    }, { timeoutMs: 120000 });
    toastSuccess(approve ? "Reference entry approved" : "Reference review saved");
    await Promise.all([loadSummary(), loadEntries(), openEntry(selectedEntry.reference_entry_id)]);
  } catch (error) {
    if (error instanceof ApiError && ["VALIDATION_FAILED", "CONFLICT"].includes(error.code)) toast(error.message, "error");
  }
}

async function importVisuals(files) {
  const byName = new Map(files.map((file) => [file.name.toLowerCase(), file]));
  const required = (selectedRecord.visual_references ?? []).flatMap((visual) => {
    const variants = [];
    if (visual.browser_master_file) variants.push({ visual, variant: "master", file: visual.browser_master_file });
    if (visual.enhanced_derivative?.file) variants.push({ visual, variant: "enhanced", file: visual.enhanced_derivative.file });
    return variants;
  });
  let imported = 0;
  for (const item of required) {
    const filename = item.file.split("/").pop().toLowerCase();
    const file = byName.get(filename);
    if (!file) continue;
    progressEl.textContent = `Importing ${filename}…`;
    const dataUrl = await fileToDataUrl(file);
    await api("import_reference_visual", {
      reference_entry_id: selectedEntry.reference_entry_id,
      asset_id: item.visual.asset_id,
      variant: item.variant,
      data_url: dataUrl,
    }, { timeoutMs: 120000 });
    imported++;
  }
  progressEl.textContent = `${imported}/${required.length} visuals imported for ${selectedRecord.breed.name}.`;
  if (imported) await openEntry(selectedEntry.reference_entry_id);
}

async function loadVisual(node, variant = "master") {
  const target = node.querySelector("[data-visual-target]");
  target.textContent = variant === "enhanced" ? "Loading enhanced derivative…" : "Loading exact master…";
  try {
    const data = await api("get_reference_visual", {
      reference_entry_id: selectedEntry.reference_entry_id,
      asset_id: node.dataset.assetId,
      variant,
    }, { timeoutMs: 120000 });
    target.innerHTML = `<p class="muted">${variant === "enhanced" ? "Enhanced derivative (source master retained unchanged)" : "Exact pixel-verified source master"}</p><img alt="Source reference page" src="${data.data_url}">`;
  } catch {
    target.textContent = "Visual unavailable.";
  }
}

async function createProfile() {
  try {
    const data = await api("create_profile_from_reference", { reference_entry_id: selectedEntry.reference_entry_id }, { timeoutMs: 120000 });
    toastSuccess("Pet Groom draft created");
    location.href = `profile.html?profile_id=${encodeURIComponent(data.profile_id)}`;
  } catch (error) {
    if (error instanceof ApiError && ["VALIDATION_FAILED", "CONFLICT"].includes(error.code)) toast(error.message, "error");
  }
}

function stat(value, label) { return `<div class="reference-stat"><strong>${Number(value ?? 0)}</strong><span>${escapeHtml(label)}</span></div>`; }
function riskOption(value, label, selected) { return `<option value="${value}" ${selected === value ? "selected" : ""}>${escapeHtml(label)}</option>`; }
function humanize(value) { return String(value).replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()); }
function formatValue(value) { return Array.isArray(value) ? value.join(", ") : (value ?? ""); }
function fileToDataUrl(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); }); }
function safeUrl(value) { try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) ? escapeHtml(url.href) : "#"; } catch { return "#"; } }
function debounce(fn, delay) { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); }; }
function escapeHtml(value) { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
