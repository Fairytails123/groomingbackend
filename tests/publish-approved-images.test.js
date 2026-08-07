const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "..", "apps-script", "publish.gs"), "utf8");
const approvedProfileImageFilters = source.match(
  /i\.profile_id === profile\.profile_id && \(i\.approved === true \|\| i\.approved === "TRUE"\)/g,
) ?? [];

assert.equal(
  approvedProfileImageFilters.length,
  2,
  "publish validation and pack construction must both ignore unapproved images",
);

console.log("publish approved-image regression test passed");
