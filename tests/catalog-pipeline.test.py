import hashlib
import importlib.util
import json
import math
from pathlib import Path


PROJECT = Path(__file__).resolve().parents[1]
ROOT = PROJECT / "Knowledge" / "reusable-data" / "notes-from-the-grooming-table"
FINAL = ROOT / "software-catalog-final"

if not FINAL.exists():
    print("catalog pipeline integrity test skipped: private Knowledge corpus is not present")
    raise SystemExit(0)


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def canonical_hash(value):
    def js_numbers(item):
        if isinstance(item, dict):
            return {key: js_numbers(entry) for key, entry in item.items()}
        if isinstance(item, list):
            return [js_numbers(entry) for entry in item]
        if isinstance(item, float) and math.isfinite(item) and item.is_integer():
            return int(item)
        return item
    payload = json.dumps(js_numbers(value), ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


# Regression: second-pass prompts must carry the stable queue issue keys. A
# misplaced return once turned every compact issue into null and wasted calls.
second_pass_spec = importlib.util.spec_from_file_location(
    "grooming_second_pass", ROOT / "run_second_pass.py"
)
second_pass = importlib.util.module_from_spec(second_pass_spec)
second_pass_spec.loader.exec_module(second_pass)
grouped_queue = second_pass.load_queue()
assert grouped_queue
for issues in grouped_queue.values():
    for issue in issues:
        compact = second_pass.compact_issue(issue)
        assert compact["issue_key"] == issue["issue_key"]
        assert compact["kind"] == issue["kind"]

normalization_sample = {
    "resolutions": [
        {"issue_key": "a", "kind": "blade_specification", "status": "corrected",
         "exact_value": None, "source_text": "Use #10 or #7F with the grain."},
        {"issue_key": "b", "kind": "blade_specification", "status": "confirmed",
         "exact_value": None, "source_text": "The blade marking is not legible."},
    ],
    "remaining_uncertainties": [],
}
normalization_issues = [
    {"issue_key": "a", "kind": "blade_specification"},
    {"issue_key": "b", "kind": "blade_specification"},
]
normalization_sample["resolutions"][0]["kind"] = "copy exactly"
second_pass.normalize_resolution_fields(normalization_sample, normalization_issues)
assert normalization_sample["resolutions"][0]["kind"] == "blade_specification"
assert normalization_sample["resolutions"][0]["field_normalization"]["kind_from_saved_queue"] is True
assert normalization_sample["resolutions"][0]["exact_value"] == "#10, #7F"
assert normalization_sample["resolutions"][0]["field_normalization"]["invented_value"] is False
assert normalization_sample["resolutions"][1]["status"] == "unresolved"


index = read_json(FINAL / "catalog-index.json")
assert len(index["breeds"]) == 155

for row in index["breeds"]:
    record = read_json(FINAL / row["record_file"])
    claimed = record.pop("record_sha256")
    assert canonical_hash(record) == claimed, row["breed_slug"]
    record["record_sha256"] = claimed
    assert row["record_sha256"] == claimed
    if record["review"]["status"] == "approved":
        assert all(section["approved"] and section["editorial_text"].strip() for section in record["sections"])
        assert all(item["verification_status"] == "verified_from_source_image"
                   for item in record["high_risk_review_queue"])

for slug in ("manchester-terrier-standard", "miniature-bull-terrier"):
    record = read_json(FINAL / "breeds" / f"{slug}.json")
    core = {section["section_key"] for section in record["sections"]}
    assert {"body", "throat_chest", "tail_rear", "legs_feet", "head"}.issubset(core)
    assert record["review"]["source_gap_disclosure_required"] is True
    assert record["external_supplements"]

enhancement_manifest = read_json(ROOT / "enhancement-manifest.json")
for item in enhancement_manifest["items"]:
    path = ROOT / item["enhanced_file"]
    assert hashlib.sha256(path.read_bytes()).hexdigest() == item["enhanced_sha256"]

for line in (FINAL / "checksums.sha256").read_text(encoding="utf-8").splitlines():
    expected, relative = line.split("  ", 1)
    assert hashlib.sha256((FINAL / relative).read_bytes()).hexdigest() == expected, relative

print("catalog pipeline integrity tests passed")
