/**
 * github.gs — GitHub Contents API client.
 *
 * Reads `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_PAT` from Script Properties.
 *
 * The Contents API is the simplest path: each PUT to a file path is a
 * single commit. We use it for publishing breed packs (`public/breeds/*.json`)
 * and image artefacts (`public/images/.../{image_id}.jpg`).
 *
 * For high-frequency or batched commits, the Git Trees API is more efficient,
 * but the Contents API meets our needs (~10 commits/day) and is simpler.
 */

function ghClient_() {
  const props = PropertiesService.getScriptProperties();
  const owner = props.getProperty("GITHUB_OWNER");
  const repo  = props.getProperty("GITHUB_REPO");
  const pat   = props.getProperty("GITHUB_PAT");
  if (!owner || !repo) throw apiError_("INTERNAL", "GITHUB_OWNER / GITHUB_REPO not configured");
  if (!pat) throw apiError_("INTERNAL", "GITHUB_PAT not configured (fine-grained PAT, Contents read+write on the repo)");
  return { owner, repo, pat };
}

/** GET a file's metadata (incl. SHA needed for updates). Returns null on 404. */
function ghGetFile_(path) {
  const { owner, repo, pat } = ghClient_();
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodePath_(path)}`;
  const resp = UrlFetchApp.fetch(url, {
    method: "get",
    headers: { Authorization: `Bearer ${pat}`, Accept: "application/vnd.github+json" },
    muteHttpExceptions: true,
  });
  const code = resp.getResponseCode();
  if (code === 404) return null;
  if (code !== 200) throw apiError_("GITHUB_FAILED", `GET ${path} returned ${code}: ${resp.getContentText().slice(0, 200)}`);
  return JSON.parse(resp.getContentText());
}

/**
 * PUT a file at `path` with bytes (Uint8Array or string) and a commit message.
 * Idempotent: if the file exists, includes its current SHA so this becomes an update.
 * Returns the new commit SHA on success.
 */
function ghPutFile_(path, content, commitMessage) {
  const { owner, repo, pat } = ghClient_();
  const existing = ghGetFile_(path);

  const contentB64 = typeof content === "string"
    ? Utilities.base64Encode(content, Utilities.Charset.UTF_8)
    : Utilities.base64Encode(content);

  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodePath_(path)}`;
  const body = {
    message: commitMessage,
    content: contentB64,
    branch: "main",
  };
  if (existing && existing.sha) body.sha = existing.sha;

  const resp = UrlFetchApp.fetch(url, {
    method: "put",
    headers: { Authorization: `Bearer ${pat}`, Accept: "application/vnd.github+json" },
    contentType: "application/json",
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  const code = resp.getResponseCode();
  if (code !== 200 && code !== 201) {
    throw apiError_("GITHUB_FAILED", `PUT ${path} returned ${code}: ${resp.getContentText().slice(0, 200)}`);
  }
  const json = JSON.parse(resp.getContentText());
  return json.commit?.sha ?? null;
}

/** DELETE a file. Returns true on success, false if not found. */
function ghDeleteFile_(path, commitMessage) {
  const { owner, repo, pat } = ghClient_();
  const existing = ghGetFile_(path);
  if (!existing) return false;
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodePath_(path)}`;
  const resp = UrlFetchApp.fetch(url, {
    method: "delete",
    headers: { Authorization: `Bearer ${pat}`, Accept: "application/vnd.github+json" },
    contentType: "application/json",
    payload: JSON.stringify({ message: commitMessage, sha: existing.sha, branch: "main" }),
    muteHttpExceptions: true,
  });
  const code = resp.getResponseCode();
  if (code !== 200) {
    throw apiError_("GITHUB_FAILED", `DELETE ${path} returned ${code}: ${resp.getContentText().slice(0, 200)}`);
  }
  return true;
}

function encodePath_(path) {
  // Encode each segment, preserving slashes.
  return path.split("/").map(encodeURIComponent).join("/");
}
