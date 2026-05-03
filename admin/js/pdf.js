// Browser-side PDF rendering + text extraction.
// Wraps Mozilla pdf.js (vendored at /vendor/pdfjs/) so other modules
// don't have to know the worker URL incantation.
//
// extractPdf() returns one JPEG dataURL per page plus the joined text
// content — Stage 3 Phase 2 PDF intake POSTs these directly to
// op_save_page_render and op_extract_sections.

let _pdfjsLib = null;

async function loadPdfJs() {
  if (_pdfjsLib) return _pdfjsLib;
  const lib = await import("../../vendor/pdfjs/pdf.min.mjs");
  // Worker URL must be set before any getDocument() call.
  lib.GlobalWorkerOptions.workerSrc = new URL("../../vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;
  _pdfjsLib = lib;
  return lib;
}

// Cheap pre-flight — read the PDF header just enough to count pages.
// Used by the upload page's file-change handler to show "12 pages, 8.4 MB".
export async function getPageCount(file) {
  const pdfjsLib = await loadPdfJs();
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const n = pdf.numPages;
  await pdf.destroy();
  return n;
}

// Render every page to a JPEG dataURL and concatenate per-page text.
// Returns { pages: [{ pageIndex, jpegBlobB64, widthPx, heightPx }], rawText, totalPages }.
//
// onProgress fires as { phase: "render"|"text"|"done", pageIndex, totalPages }.
export async function extractPdf(file, opts = {}) {
  const { onProgress = () => {}, jpegQuality = 0.85, maxWidthPx = 2200 } = opts;
  const pdfjsLib = await loadPdfJs();

  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const totalPages = pdf.numPages;

  const pages = [];
  const textChunks = [];

  for (let pageIndex = 1; pageIndex <= totalPages; pageIndex++) {
    const page = await pdf.getPage(pageIndex);

    // Scale to a target width, capped at 2x to keep JPEGs reasonable.
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(maxWidthPx / baseViewport.width, 2.0);
    const viewport = page.getViewport({ scale });
    const widthPx = Math.floor(viewport.width);
    const heightPx = Math.floor(viewport.height);

    // OffscreenCanvas where supported; fall back to a detached <canvas>.
    const canvas = ("OffscreenCanvas" in self)
      ? new OffscreenCanvas(widthPx, heightPx)
      : Object.assign(document.createElement("canvas"), { width: widthPx, height: heightPx });
    const ctx = canvas.getContext("2d");

    onProgress({ phase: "render", pageIndex, totalPages });
    await page.render({ canvasContext: ctx, viewport }).promise;
    const jpegBlobB64 = await canvasToJpegDataUrl(canvas, jpegQuality);

    onProgress({ phase: "text", pageIndex, totalPages });
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((it) => it.str).join(" ");
    textChunks.push(`--- Page ${pageIndex} ---\n${pageText}`);

    pages.push({ pageIndex, jpegBlobB64, widthPx, heightPx });
    page.cleanup();
  }

  await pdf.destroy();
  onProgress({ phase: "done", pageIndex: totalPages, totalPages });

  return { pages, rawText: textChunks.join("\n\n"), totalPages };
}

async function canvasToJpegDataUrl(canvas, quality) {
  if (canvas.convertToBlob) {
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
    return await blobToDataUrl(blob);
  }
  // HTMLCanvasElement fallback.
  return canvas.toDataURL("image/jpeg", quality);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
