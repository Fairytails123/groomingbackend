// Browser-side PDF intake orchestrator. Used by upload.html for the initial
// intake and by profile.html for the "Re-extract sections" flow (passing
// pdfB64 instead of a File, with skipPageRenders=true so we don't re-upload
// the renders that already exist in Drive).
//
// The pipeline runs sequential ops so each step's withProfileLock_ is honoured
// and the user sees fine-grained progress. AI ops use a longer timeout.

import { api, ApiError } from "./api.js";
import { extractPdf } from "./pdf.js";
import { getTokenExpiry } from "./auth.js";

const AI_TIMEOUT_MS = 90 * 1000;     // extract_sections + vision_pass_page can take 30s+
const UPLOAD_TIMEOUT_MS = 120 * 1000; // PDF upload to Drive over a slow link

// 90 minutes — refuse to start if the session won't survive a typical run.
const MIN_SESSION_HEADROOM_MS = 90 * 60 * 1000;

/**
 * @param opts.profileId           required
 * @param opts.pdfFile             File from <input type=file> (initial intake)
 * @param opts.pdfB64              base64 dataURL or raw base64 (re-extract path)
 * @param opts.originalFilename    used when pdfB64 is given
 * @param opts.onProgress          ({ step, status, message, ...details }) => void
 * @param opts.skipPageRenders     true on re-extract — page renders already exist
 *
 * Returns { profile_id, status, partial_failures, page_render_ids, sections_updated }.
 */
export async function runPdfIntake(opts) {
  const {
    profileId,
    pdfFile,
    pdfB64,
    originalFilename,
    onProgress = () => {},
    skipPageRenders = false,
  } = opts;

  if (!profileId) throw new Error("profileId required");
  if (!pdfFile && !pdfB64) throw new Error("either pdfFile or pdfB64 required");

  // Token-expiry guard — a 60s mid-flow logout is the worst failure mode.
  const remaining = getTokenExpiry() - Date.now();
  if (remaining < MIN_SESSION_HEADROOM_MS) {
    throw new Error("Session expires too soon — sign out and back in, then retry.");
  }

  const partialFailures = [];

  // ── Step 1: upload_pdf ─────────────────────────────────────────────
  onProgress({ step: "upload", status: "running", message: "Uploading PDF…" });
  const uploadB64 = pdfB64 ?? await fileToB64(pdfFile);
  const uploadFilename = originalFilename ?? pdfFile?.name ?? "source.pdf";
  await api("upload_pdf", {
    profile_id: profileId,
    pdf_blob_b64: uploadB64,
    original_filename: uploadFilename,
  }, { timeoutMs: UPLOAD_TIMEOUT_MS });
  onProgress({ step: "upload", status: "done", message: `Uploaded ${uploadFilename}` });

  // ── Step 2 + 3: render pages + save renders ────────────────────────
  onProgress({ step: "render", status: "running", message: "Rendering pages…" });

  let pages, rawText, totalPages;
  if (pdfFile) {
    const result = await extractPdf(pdfFile, {
      onProgress: ({ phase, pageIndex, totalPages: tp }) => {
        if (phase === "render") {
          onProgress({ step: "render", status: "running", message: `Rendering page ${pageIndex} of ${tp}…`, pageIndex, totalPages: tp });
        }
      },
    });
    pages = result.pages;
    rawText = result.rawText;
    totalPages = result.totalPages;
  } else {
    // Re-extract path: reconstruct a Blob from base64 so pdf.js can re-render.
    const blob = base64ToBlob(uploadB64, "application/pdf");
    const result = await extractPdf(blob, {
      onProgress: ({ phase, pageIndex, totalPages: tp }) => {
        if (phase === "render") {
          onProgress({ step: "render", status: "running", message: `Rendering page ${pageIndex} of ${tp}…`, pageIndex, totalPages: tp });
        }
      },
    });
    pages = result.pages;
    rawText = result.rawText;
    totalPages = result.totalPages;
  }
  onProgress({ step: "render", status: "done", message: `Rendered ${totalPages} pages.` });

  let pageRenderIds = [];
  if (skipPageRenders) {
    onProgress({ step: "pages", status: "skipped", message: "Re-extract: page renders already exist." });
    // We still need the page_render_ids for the vision pass. Pull from the profile.
    const detail = await api("get_breed_profile", { profile_id: profileId });
    pageRenderIds = (detail.page_renders ?? []).map((r) => r.page_render_id);
  } else {
    onProgress({ step: "pages", status: "running", message: `Saving ${pages.length} page renders…` });
    for (const page of pages) {
      const result = await api("save_page_render", {
        profile_id: profileId,
        page_index: page.pageIndex,
        width_px: page.widthPx,
        height_px: page.heightPx,
        jpeg_blob_b64: page.jpegBlobB64,
      }, { timeoutMs: UPLOAD_TIMEOUT_MS });
      pageRenderIds.push(result.page_render_id);
      onProgress({ step: "pages", status: "running", message: `Saved page ${page.pageIndex} of ${pages.length}.`, pageIndex: page.pageIndex, totalPages: pages.length });
    }
    onProgress({ step: "pages", status: "done", message: `Saved ${pageRenderIds.length} page renders.` });
  }

  // ── Step 4: extract_sections (gpt-4o-mini) ─────────────────────────
  onProgress({ step: "extract", status: "running", message: "Extracting structured sections via GPT-4o-mini…" });
  const extract = await api("extract_sections", {
    profile_id: profileId,
    raw_text: rawText,
  }, { timeoutMs: AI_TIMEOUT_MS });
  onProgress({
    step: "extract",
    status: "done",
    message: `Updated ${extract.sections_updated} core sections; ${extract.extra_headings_pending} extra headings pending. Confidence ${(extract.overall_confidence ?? 0).toFixed(2)}.`,
  });

  // ── Step 5: vision pass per page ───────────────────────────────────
  onProgress({ step: "vision", status: "running", message: `Vision pass on ${pageRenderIds.length} page(s)…` });
  for (let i = 0; i < pageRenderIds.length; i++) {
    const pageRenderId = pageRenderIds[i];
    try {
      const visionResult = await api("run_vision_pass_page", {
        profile_id: profileId,
        page_render_id: pageRenderId,
      }, { timeoutMs: AI_TIMEOUT_MS });
      onProgress({
        step: "vision",
        status: "running",
        message: `Page ${visionResult.page_index}: ${visionResult.findings_count} finding(s), ${visionResult.blade_numbers_added} new blade(s).`,
        pageIndex: visionResult.page_index,
        totalPages: pageRenderIds.length,
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err);
      partialFailures.push({ page_render_id: pageRenderId, message });
      onProgress({ step: "vision", status: "running", message: `Page ${i + 1} failed: ${message}. Continuing.` });
    }
  }
  onProgress({
    step: "vision",
    status: partialFailures.length ? "warning" : "done",
    message: partialFailures.length
      ? `${partialFailures.length} of ${pageRenderIds.length} page(s) failed; the rest succeeded.`
      : `All ${pageRenderIds.length} page(s) processed.`,
  });

  // ── Step 6: finalize ───────────────────────────────────────────────
  onProgress({ step: "finalize", status: "running", message: "Flipping status to Needs Review…" });
  const finalize = await api("finalize_pdf_intake", {
    profile_id: profileId,
    partial_failures: partialFailures,
  });
  onProgress({ step: "finalize", status: "done", message: `Done. Status: ${finalize.status}.` });

  return {
    profile_id: profileId,
    status: finalize.status,
    partial_failures: partialFailures,
    page_render_ids: pageRenderIds,
    sections_updated: extract.sections_updated,
    extra_headings_pending: extract.extra_headings_pending,
    overall_confidence: extract.overall_confidence,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

function fileToB64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function base64ToBlob(b64OrDataUrl, contentType = "application/octet-stream") {
  const clean = String(b64OrDataUrl).replace(/^data:[^,]+,/, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: contentType });
}
