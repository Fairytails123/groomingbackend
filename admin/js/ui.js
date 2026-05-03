// UI helpers — toast notifications, status pill renderer, simple modal.

const TOAST_TIMEOUT_MS = 4000;

export function toast(message, kind = "default") {
  const root = document.getElementById("toast-container");
  if (!root) {
    console.warn("[ui] no toast-container in DOM; logging instead:", kind, message);
    return;
  }
  const el = document.createElement("div");
  el.className = `toast${kind === "default" ? "" : ` toast--${kind}`}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transition = "opacity 200ms";
    setTimeout(() => el.remove(), 200);
  }, TOAST_TIMEOUT_MS);
}

export const toastSuccess = (msg) => toast(msg, "success");
export const toastError   = (msg) => toast(msg, "error");

const STATUS_LABELS = {
  Draft: "Draft",
  Processing: "Processing",
  "Needs Review": "Needs review",
  Published: "Published",
  Archived: "Archived",
  Failed: "Failed",
};

const STATUS_CLASSES = {
  Draft: "pill--draft",
  Processing: "pill--processing",
  "Needs Review": "pill--needs-review",
  Published: "pill--published",
  Archived: "pill--archived",
  Failed: "pill--failed",
};

export function statusPill(status) {
  const span = document.createElement("span");
  span.className = `pill ${STATUS_CLASSES[status] ?? "pill--draft"}`;
  span.textContent = STATUS_LABELS[status] ?? status;
  return span;
}

// Minimal modal. confirm() returns a Promise<boolean>.
export function confirmDialog({ title, body, confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false }) {
  return new Promise((resolve) => {
    const root = document.getElementById("modal-root") ?? document.body;
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal__header"><h2 id="modal-title">${escapeHtml(title)}</h2></div>
        <div>${escapeHtml(body)}</div>
        <div class="modal__footer">
          <button class="btn btn--secondary" data-action="cancel">${escapeHtml(cancelLabel)}</button>
          <button class="btn ${danger ? "btn--danger" : ""}" data-action="confirm">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>`;
    root.appendChild(backdrop);
    const finish = (value) => { backdrop.remove(); resolve(value); };
    backdrop.addEventListener("click", (e) => {
      const action = e.target.dataset?.action;
      if (action === "confirm") finish(true);
      else if (action === "cancel" || e.target === backdrop) finish(false);
    });
    backdrop.querySelector("[data-action=confirm]").focus();
  });
}

export function formDialog({ title, fields, submitLabel = "Save" }) {
  return new Promise((resolve) => {
    const root = document.getElementById("modal-root") ?? document.body;
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const fieldHtml = fields.map((f) => `
      <div style="margin-bottom:var(--space-3);">
        <label for="modal-${f.name}">${escapeHtml(f.label)}</label>
        ${f.type === "select"
          ? `<select id="modal-${f.name}" name="${f.name}" ${f.required ? "required" : ""}>
              ${f.options.map(o => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join("")}
             </select>`
          : `<input id="modal-${f.name}" name="${f.name}" type="${f.type ?? "text"}" ${f.required ? "required" : ""} ${f.value ? `value="${escapeHtml(f.value)}"` : ""}>`}
      </div>`).join("");
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal__header"><h2 id="modal-title">${escapeHtml(title)}</h2></div>
        <form id="modal-form">${fieldHtml}</form>
        <div class="modal__footer">
          <button class="btn btn--secondary" type="button" data-action="cancel">Cancel</button>
          <button class="btn" type="submit" form="modal-form">${escapeHtml(submitLabel)}</button>
        </div>
      </div>`;
    root.appendChild(backdrop);
    const finish = (value) => { backdrop.remove(); resolve(value); };
    backdrop.querySelector("#modal-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target));
      finish(data);
    });
    backdrop.addEventListener("click", (e) => {
      const action = e.target.dataset?.action;
      if (action === "cancel" || e.target === backdrop) finish(null);
    });
    backdrop.querySelector("input,select")?.focus();
  });
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
