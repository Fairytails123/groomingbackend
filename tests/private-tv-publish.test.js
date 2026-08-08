const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "apps-script", "private-tv-publish.gs"), "utf8");
const publishSource = fs.readFileSync(path.join(root, "apps-script", "publish.gs"), "utf8");
const codeSource = fs.readFileSync(path.join(root, "apps-script", "Code.gs"), "utf8");
const publishUi = fs.readFileSync(path.join(root, "admin", "js", "pages", "publish.js"), "utf8");

assert.doesNotMatch(source, /ghPutFile_|ghDeleteFile_|publishImagesToGitHub_/,
  "private TV release reconciliation must never publish content to GitHub");
assert.match(publishSource, /ALLOW_LEGACY_PUBLIC_PUBLISH/,
  "legacy public publishing must fail closed unless explicitly re-enabled");
assert.match(publishSource, /PRIVATE_TV_RELEASE_REQUIRED/,
  "reference profiles must be routed away from the legacy publisher");
assert.match(codeSource, /register_private_tv_release:\s*op_register_private_tv_release/);
assert.match(codeSource, /private_tv_release_status:\s*op_private_tv_release_status/);
const publicOps = codeSource.slice(codeSource.indexOf("const PUBLIC_OPS"));
assert.doesNotMatch(publicOps, /register_private_tv_release|private_tv_release_status/,
  "private release operations must require admin or service authentication");
assert.doesNotMatch(publishUi, /pushes?.*GitHub Pages/i,
  "admin publishing UI must not advertise the retired public pipeline");
assert.match(publishUi, /register_private_tv_release/);

const context = {
  console,
  apiError_: (code, message) => Object.assign(new Error(message), { code }),
};
vm.createContext(context);
vm.runInContext(`${source}\nthis.__privateTvTest = {
  validatePrivateTvReleasePayload_, privateTvReleasePlan_
};`, context);
const lib = context.__privateTvTest;

const hash = "a".repeat(64);
const valid = {
  release_id: "20260808-knowledge-v2",
  manifest_sha256: hash,
  checksums_sha256: "b".repeat(64),
  source_pdf_sha256: "c".repeat(64),
  generated_at: "2026-08-08T08:52:07.979Z",
  breed_count: 2,
  profile_count: 2,
  section_count: 10,
  image_count: 3,
  breed_pack_sha256: { "alpha-dog": hash, "beta-dog": "d".repeat(64) },
};
const release = lib.validatePrivateTvReleasePayload_(valid);
assert.equal(release.breed_count, 2);
assert.deepEqual(Object.keys(release.breed_pack_sha256), ["alpha-dog", "beta-dog"]);

const entries = [
  { breed_slug: "alpha-dog", review_status: "approved", profile_id: "PRF-002" },
  { breed_slug: "beta-dog", review_status: "approved", profile_id: "" },
];
const profiles = [
  { profile_id: "PRF-002", breed_id: "BRD-002", source_type: "reference-catalog", status: "Needs Review" },
  { profile_id: "PRF-001", breed_id: "BRD-001", source_type: "pdf", status: "Published" },
];
const breeds = [
  { breed_id: "BRD-002", slug: "alpha-dog" },
  { breed_id: "BRD-001", slug: "beta-dog" },
];
const plan = lib.privateTvReleasePlan_(release, entries, profiles, breeds);
assert.equal(plan.linked.length, 1);
assert.equal(plan.existing.length, 1);
assert.equal(plan.linked[0].profile.profile_id, "PRF-002");

assert.throws(() => lib.validatePrivateTvReleasePayload_({ ...valid, manifest_sha256: "bad" }),
  { code: "VALIDATION_FAILED" });
assert.throws(() => lib.validatePrivateTvReleasePayload_({ ...valid, breed_count: 3 }),
  { code: "VALIDATION_FAILED" });
assert.throws(() => lib.privateTvReleasePlan_(release, entries, profiles.filter((p) => p.profile_id !== "PRF-001"), breeds),
  { code: "VALIDATION_FAILED" });
assert.throws(() => lib.privateTvReleasePlan_(release,
  [{ ...entries[0], review_status: "needs_review" }, entries[1]], profiles, breeds),
  { code: "VALIDATION_FAILED" });

console.log("private TV publish regression tests passed");
