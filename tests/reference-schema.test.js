const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const context = { console };
vm.createContext(context);
vm.runInContext(
  `${fs.readFileSync(path.join(root, "apps-script", "setup.gs"), "utf8")}\nthis.__schemas = SHEET_SCHEMAS;`,
  context,
);
vm.runInContext(
  `${fs.readFileSync(path.join(root, "apps-script", "ids.gs"), "utf8")}\nthis.__ids = ID_PREFIXES;`,
  context,
);

const schemas = JSON.parse(JSON.stringify(context.__schemas));
assert.equal(Object.keys(schemas).length, 16);
assert.ok(schemas["Reference Sources"].includes("source_pdf_sha256"));
assert.ok(schemas["Reference Entries"].includes("record_sha256"));
assert.ok(schemas["Reference Entries"].includes("stored_record_sha256"));
assert.equal(context.__ids.reference, "REF");

console.log("reference schema regression test passed");
