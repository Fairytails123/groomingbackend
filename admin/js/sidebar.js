// Shared sidebar helpers — used by every admin page.
//
// Every admin page (dashboard, library, upload, publish, profile, groom-types)
// renders an identical sidebar with these count placeholders:
//   <span class="count" data-sb-count="breeds">
//   <span class="count" data-sb-count="review">
//   <span class="count" data-sb-count="publish">
// This module fills them in. Each page calls populateSidebarCounts() once on
// load. Failures are silent — an unfilled count leaves the placeholder empty,
// which the .count CSS still renders as a small pill, just without a number.

import { api } from "./api.js";

let inFlight = null;

export function populateSidebarCounts() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const [breedsData, statusData] = await Promise.all([
      api("list_breeds", {}).catch(() => null),
      api("dashboard_status_counts").catch(() => null),
    ]);

    if (breedsData?.breeds) {
      setSidebarCount("breeds", breedsData.breeds.length);
    }
    if (statusData?.counts) {
      const c = statusData.counts;
      setSidebarCount("review", c["Needs Review"] ?? 0);
      // Same proxy as the home "Ready to publish" stat tile — see
      // dashboard.js loadStats(). When a validation API op lands, both should
      // switch to the validated-Drafts subset together.
      setSidebarCount("publish", c.Draft ?? 0);
    }
  })();
  return inFlight;
}

function setSidebarCount(key, value) {
  const els = document.querySelectorAll(`[data-sb-count="${key}"]`);
  for (const el of els) el.textContent = String(value);
}
