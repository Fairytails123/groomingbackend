/**
 * session_pack.gs — Stage 4 cron handlers.
 *
 * Builds today.json and tomorrow.json from JotForm submissions, runs each
 * raw breed through the fuzzy matcher, pushes the result to GitHub Pages.
 * Also composes the morning prep alert and writes to Telegram Outbox.
 *
 * JotForm form: `251190647924057` (Grooming Appointment).
 *
 * One-time setup needed (Kamal):
 *   - Get JotForm API key: jotform.com → My Account → API → Create Key
 *   - Set Script Property `JOTFORM_API_KEY` = (the key)
 *   - Run discoverJotFormFields() once to populate the conditional date field IDs
 */

const JOTFORM_API_BASE = "https://api.jotform.com";
const JOTFORM_FORM_ID = "251190647924057";

const APPT_TYPES_FULL_GROOM = new Set([
  "Full Groom or Hand Strip — with bus pick-up/drop-off",
  "Full Groom or Hand Strip — parent drop-off/pick-up",
]);

/**
 * Discovery — calls JotForm /form/{id}/questions and prints field IDs.
 * Run once after setting JOTFORM_API_KEY. Inspect Logger output and fill in
 * the JOTFORM_FIELD_* Script Properties manually, OR adjust this function
 * to auto-detect by question text.
 */
function discoverJotFormFields() {
  const apiKey = PropertiesService.getScriptProperties().getProperty("JOTFORM_API_KEY");
  if (!apiKey) throw new Error("Set JOTFORM_API_KEY Script Property first.");
  const url = `${JOTFORM_API_BASE}/form/${JOTFORM_FORM_ID}/questions?apiKey=${encodeURIComponent(apiKey)}`;
  const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) {
    Logger.log(`JotForm /questions returned ${resp.getResponseCode()}: ${resp.getContentText().slice(0, 500)}`);
    return;
  }
  const data = JSON.parse(resp.getContentText());
  Logger.log("=== JotForm form fields ===");
  for (const [qid, q] of Object.entries(data.content ?? {})) {
    Logger.log(`  qid=${qid}  type=${q.type}  text=${(q.text ?? "").slice(0, 80)}`);
  }
  Logger.log("Map the relevant qid values into Script Properties:");
  Logger.log("  JOTFORM_FIELD_BREED        — qid for the breed (free-text) field");
  Logger.log("  JOTFORM_FIELD_DOG_NAME     — qid for the dog's name");
  Logger.log("  JOTFORM_FIELD_APPT_TYPE    — qid for the appointment-type radio");
  Logger.log("  JOTFORM_FIELD_DATE_FG_BUS  — qid for date when type = Full Groom + bus");
  Logger.log("  JOTFORM_FIELD_DATE_FG_PRT  — qid for date when type = Full Groom + parent");
}

// ─── op: rebuild_today_json ─────────────────────────────────────────

function op_rebuild_today_json(body) {
  return rebuildSessionPack_(0, "today");
}

function op_rebuild_tomorrow_json(body) {
  return rebuildSessionPack_(1, "tomorrow");
}

function rebuildSessionPack_(daysFromToday, label) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  const isoDate = Utilities.formatDate(date, "Etc/UTC", "yyyy-MM-dd");
  const submissions = fetchJotFormSubmissionsForDate_(isoDate);
  const fullGroom = submissions.filter((s) => isFullGroomAppointment_(s));

  const bookings = fullGroom.map((s) => {
    const rawBreed = extractField_(s, "JOTFORM_FIELD_BREED") ?? "";
    const match = matchBreed_(rawBreed);
    const apptDateTime = extractAppointmentDateTime_(s);
    const apptType = extractField_(s, "JOTFORM_FIELD_APPT_TYPE") ?? "";

    const breed = match.matched_breed_id ? findBreedSafe_(match.matched_breed_id) : null;
    return {
      booking_id: `JF-${s.id}`,
      appointment_datetime: apptDateTime,
      appointment_type: classifyAppointmentType_(apptType),
      raw_breed: rawBreed,
      matched: !!match.matched_breed_id,
      breed_id: match.matched_breed_id,
      breed_slug: breed?.slug ?? null,
      breed_pack_url: breed ? `/groomingbackend/public/breeds/${breed.slug}.json` : null,
      fallback: match.matched_breed_id ? null : {
        reason: "not_in_kb",
        suggested_breed_ids: match.suggestions.map((c) => c.breed_id),
      },
    };
  });

  const pack = {
    schema_version: 1,
    generated_at: nowIso_(),
    session_date: isoDate,
    saturday_open: false,
    bookings,
  };

  const filename = label === "today" ? "today.json" : "tomorrow.json";
  const path = `public/${filename}`;
  ghPutFile_(path, JSON.stringify(pack, null, 2),
    `Rebuild ${label} session pack — ${isoDate} — ${bookings.length} booking(s)`);

  return { date: isoDate, breeds: bookings.length, path };
}

// ─── op: send_tomorrow_prep_alert ───────────────────────────────────

function op_send_tomorrow_prep_alert(body) {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  const isoDate = Utilities.formatDate(date, "Etc/UTC", "yyyy-MM-dd");

  const submissions = fetchJotFormSubmissionsForDate_(isoDate);
  const fullGroom = submissions.filter((s) => isFullGroomAppointment_(s));

  // Group by matched breed.
  const buckets = { published: [], draft: [], missing: [] };
  for (const s of fullGroom) {
    const rawBreed = extractField_(s, "JOTFORM_FIELD_BREED") ?? "";
    const match = matchBreed_(rawBreed);
    if (!match.matched_breed_id) { buckets.missing.push({ rawBreed }); continue; }
    const profileStatus = breedKbStatus_(match.matched_breed_id);
    if (profileStatus === "published") buckets.published.push({ ...match, rawBreed });
    else if (profileStatus === "draft") buckets.draft.push({ ...match, rawBreed });
    else buckets.missing.push({ rawBreed, ...match });
  }

  const message = composePrepMessage_(isoDate, buckets);

  // Write to Telegram Outbox sheet (real Telegram send happens once bot token is configured).
  const outboxSheet = getDb_().getSheetByName("Telegram Outbox");
  if (outboxSheet) {
    appendRow_(outboxSheet, readSheet_("Telegram Outbox").headers, {
      outbox_id: `OUT-${Utilities.getUuid().slice(0, 8)}`,
      intended_chat_id: PropertiesService.getScriptProperties().getProperty("TELEGRAM_CHAT_ID") ?? "",
      message_text: message,
      inline_buttons_json: "[]",
      scheduled_for: nowIso_(),
      status: "pending",
      sent_at: "",
      error: "",
    });
  }

  return {
    date: isoDate,
    counts: {
      published: buckets.published.length,
      draft: buckets.draft.length,
      missing: buckets.missing.length,
    },
    message,
  };
}

function composePrepMessage_(isoDate, buckets) {
  const lines = [`📋 Tomorrow (${isoDate}) — ${buckets.published.length + buckets.draft.length + buckets.missing.length} grooms`, ""];
  if (buckets.published.length) {
    lines.push(`✅ Already published (${buckets.published.length})`);
    for (const b of buckets.published) lines.push(`  • ${b.matched_breed_name}`);
    lines.push("");
  }
  if (buckets.draft.length) {
    lines.push(`⚠️ Draft only (${buckets.draft.length})`);
    for (const b of buckets.draft) lines.push(`  • ${b.matched_breed_name}`);
    lines.push("");
  }
  if (buckets.missing.length) {
    lines.push(`❌ Not in system (${buckets.missing.length})`);
    for (const b of buckets.missing) lines.push(`  • ${b.rawBreed}`);
    lines.push("");
  }
  lines.push("You have today to fit these in. Anything not done is just skipped — they'll come round again.");
  return lines.join("\n");
}

// ─── JotForm helpers ────────────────────────────────────────────────

function fetchJotFormSubmissionsForDate_(isoDate) {
  const apiKey = PropertiesService.getScriptProperties().getProperty("JOTFORM_API_KEY");
  if (!apiKey) {
    Logger.log("[session-pack] JOTFORM_API_KEY not set — returning empty submissions list.");
    return [];
  }
  // JotForm submissions API: /form/{id}/submissions?apiKey=...&filter=...
  // We filter client-side because JotForm's date filter is on submission date, not appointment date.
  const url = `${JOTFORM_API_BASE}/form/${JOTFORM_FORM_ID}/submissions?apiKey=${encodeURIComponent(apiKey)}&limit=1000`;
  const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) {
    Logger.log(`[session-pack] JotForm /submissions returned ${resp.getResponseCode()}`);
    return [];
  }
  const data = JSON.parse(resp.getContentText());
  const all = data.content ?? [];
  return all.filter((s) => extractAppointmentDateTime_(s).startsWith(isoDate));
}

function extractField_(submission, propertyKey) {
  const qid = PropertiesService.getScriptProperties().getProperty(propertyKey);
  if (!qid) return null;
  const ans = submission.answers?.[qid];
  if (!ans) return null;
  return ans.answer ?? ans.prettyFormat ?? null;
}

function extractAppointmentDateTime_(submission) {
  // Try each conditional date field in order.
  const candidates = [
    "JOTFORM_FIELD_DATE_FG_BUS",
    "JOTFORM_FIELD_DATE_FG_PRT",
  ];
  for (const key of candidates) {
    const value = extractField_(submission, key);
    if (value) {
      // JotForm date format varies by widget — common shapes are
      // {date:"2026-05-04", time:"09:30"} or "2026-05-04 09:30" or "MM/DD/YYYY".
      if (typeof value === "object" && value.date) {
        const time = value.time ?? "00:00";
        return `${value.date}T${time}:00`;
      }
      if (typeof value === "string") {
        // Best-effort parse.
        const m = value.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (m) return `${m[1]}-${m[2]}-${m[3]}T00:00:00`;
      }
    }
  }
  // Fall back to submission timestamp so we don't crash.
  return (submission.created_at ?? "").replace(" ", "T") || nowIso_();
}

function isFullGroomAppointment_(submission) {
  const apptType = extractField_(submission, "JOTFORM_FIELD_APPT_TYPE");
  return apptType && APPT_TYPES_FULL_GROOM.has(apptType);
}

function classifyAppointmentType_(rawType) {
  if (typeof rawType !== "string") return "unknown";
  if (rawType.toLowerCase().includes("bus")) return "full_groom_bus";
  if (rawType.toLowerCase().includes("parent")) return "full_groom_parent";
  return "unknown";
}

function findBreedSafe_(breedId) {
  try { return findBreed_(breedId); } catch { return null; }
}

function breedKbStatus_(breedId) {
  const { rows: profiles } = readSheet_("Groom Profiles");
  const forBreed = profiles.filter((p) => p.breed_id === breedId && p.status !== "Archived");
  if (forBreed.some((p) => p.status === "Published")) return "published";
  if (forBreed.length > 0) return "draft";
  return "missing";
}
