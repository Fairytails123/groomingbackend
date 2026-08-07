const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(projectRoot, "apps-script", "reference-library.gs"), "utf8");
assert.doesNotMatch(source, /makeFilePublicForServing_|setSharing\s*\(/,
  "private reference catalogue must not expose source assets publicly");
const codeSource = fs.readFileSync(path.join(projectRoot, "apps-script", "Code.gs"), "utf8");
const publicOpsSource = codeSource.slice(codeSource.indexOf("const PUBLIC_OPS"));
assert.doesNotMatch(publicOpsSource, /reference_(catalog|entry|visual|review)/,
  "reference catalogue operations must never be public");
assert.match(codeSource, /import_reference_visuals_batch:\s*op_import_reference_visuals_batch/);
const adminReferenceSource = fs.readFileSync(
  path.join(projectRoot, "admin", "js", "pages", "reference-library.js"), "utf8");
const bulkImportSource = adminReferenceSource.slice(
  adminReferenceSource.indexOf("async function importCatalogVisuals"),
  adminReferenceSource.indexOf("async function openEntry"),
);
assert.match(bulkImportSource, /api\("import_reference_visuals_batch"/,
  "bulk catalogue import must write one batch per breed");
assert.doesNotMatch(bulkImportSource, /api\("import_reference_visual"/,
  "bulk catalogue import must not rewrite the record once per image");
const context = {
  console,
  sha256Hex_: (value) => crypto.createHash("sha256").update(value, "utf8").digest("hex"),
  Utilities: {
    DigestAlgorithm: { SHA_256: "SHA_256" },
    Charset: { UTF_8: "UTF_8" },
    computeDigest: (_algorithm, value, _charset) => [...crypto.createHash("sha256").update(value, "utf8").digest()],
  },
  apiError_: (code, message) => Object.assign(new Error(message), { code, apiError: true }),
};
vm.createContext(context);
vm.runInContext(`${source}\nthis.__referenceTest = {\n  referenceRecordSourceHash_,\n  referenceReviewCounters_,\n  isResolvedReferenceStatus_,\n  applyReferenceReviewPatch_,\n  verifiedReferenceBlades_,\n  referenceVisualVariant_\n};`, context);

const lib = context.__referenceTest;

const sample = {
  sections: [
    { section_key: "body", editorial_text: "", approved: false },
    { section_key: "head", editorial_text: "Reviewed head guidance", approved: true },
  ],
  high_risk_review_queue: [
    { review_id: "risk-1", kind: "blade_specification", source_pdf_page: 10, verification_status: "needs_visual_review", verified_value: null },
    { review_id: "risk-2", kind: "grooming_boundary", source_pdf_page: 11, verification_status: "verified_from_source_image", verified_value: "At the shoulder turn" },
  ],
  external_supplements: [],
};

assert.deepEqual(
  JSON.parse(JSON.stringify(lib.referenceReviewCounters_(sample))),
  { sectionsTotal: 2, sectionsApproved: 1, highRiskTotal: 2, highRiskVerified: 1 },
);
assert.equal(lib.isResolvedReferenceStatus_("needs_visual_review"), false);
assert.equal(lib.isResolvedReferenceStatus_("verified_from_source_image"), true);

lib.applyReferenceReviewPatch_(sample, {
  sections: [{ section_key: "body", editorial_text: "Reviewed body guidance", approved: true }],
  high_risk_items: [{
    review_id: "risk-1",
    verified_value: ["#10", "#7F"],
    verification_status: "verified_from_source_image",
    verification_source: { pdf_page: 286 },
  }],
});
assert.equal(sample.sections[0].approved, true);
assert.deepEqual(
  JSON.parse(JSON.stringify(lib.referenceReviewCounters_(sample))),
  { sectionsTotal: 2, sectionsApproved: 2, highRiskTotal: 2, highRiskVerified: 2 },
);
assert.deepEqual(Array.from(lib.verifiedReferenceBlades_(sample)), ["#10", "#7F"]);
assert.deepEqual(Array.from(lib.verifiedReferenceBlades_(sample, [11], false)), [],
  "section blade pills must not inherit verified blades from unrelated source pages");
assert.deepEqual(Array.from(lib.verifiedReferenceBlades_(sample, [10], false)), ["#10", "#7F"]);

const visual = {
  browser_master_encoded_sha256: "ABC123",
  drive_file_id: "master-file",
  enhanced_derivative: { encoded_sha256: "DEF456", drive_file_id: "enhanced-file" },
};
assert.deepEqual(
  JSON.parse(JSON.stringify(lib.referenceVisualVariant_(visual, "master"))),
  { expectedHash: "abc123", driveFileId: "master-file" },
);
assert.deepEqual(
  JSON.parse(JSON.stringify(lib.referenceVisualVariant_(visual, "enhanced"))),
  { expectedHash: "def456", driveFileId: "enhanced-file" },
);
assert.throws(() => lib.referenceVisualVariant_(visual, "unknown"), { code: "VALIDATION_FAILED" });

const catalogueDir = path.join(projectRoot, "Knowledge", "reusable-data", "notes-from-the-grooming-table",
  "software-catalog-final", "breeds");
if (fs.existsSync(catalogueDir)) {
  const records = fs.readdirSync(catalogueDir).filter((name) => name.endsWith(".json"));
  assert.equal(records.length, 155);
  for (const filename of records) {
    const record = JSON.parse(fs.readFileSync(path.join(catalogueDir, filename), "utf8"));
    assert.equal(lib.referenceRecordSourceHash_(record), record.record_sha256, filename);
  }
  const sampleRecord = JSON.parse(fs.readFileSync(path.join(catalogueDir, records[0]), "utf8"));
  const originalHash = sampleRecord.record_sha256;
  sampleRecord.breed.name = "Tampered name";
  assert.notEqual(lib.referenceRecordSourceHash_(sampleRecord), originalHash);
}

console.log("reference-library tests passed");
