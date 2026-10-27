// Pull request status from GitHub: polled for open PRs on demand, pushed instantly by the webhook.
import { decryptText } from './crypto.js';
import { USER_AGENT } from './oauth.js';
import { saveNotes } from './notes.js';
import { safeJson, toApi } from './rows.js';

const GITHUB_API = 'https://api.github.com';
const GITHUB_ACTOR = /** @type {const} */ ({ type: 'github', name: 'github' });
// Open PRs are re-checked at most this often per note, and at most MAX_NOTES_PER_REFRESH notes per call.
const RECHECK_MS = 120_000;
const MAX_NOTES_PER_REFRESH = 10;

/** The signed-in user's GitHub OAuth token, else the shared GITHUB_TOKEN secret, else none (public repos only). @param {Record<string, any>} env @param {string} userId */
export async function githubToken(env, userId) {
  const row = await env.DB.prepare("SELECT access_token FROM identities WHERE user_id = ? AND provider = 'github' AND access_token IS NOT NULL").bind(userId).first();
  if (row?.access_token && env.TOKEN_ENCRYPTION_KEY) {
    try {
      return await decryptText(String(row.access_token), env.TOKEN_ENCRYPTION_KEY);
    } catch { /* key rotated: fall through */ }
  }
  return env.GITHUB_TOKEN || null;
}

/**
 * Fetches one PR and returns its current state, or null when GitHub can't be reached.
 * @param {string | null} token
 * @param {{ repo: string, number: number }} pr
 */
export async function fetchPullRequest(token, pr) {
  /** @type {Record<string, string>} */
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': USER_AGENT };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${GITHUB_API}/repos/${pr.repo}/pulls/${pr.number}`, { headers });
  if (!response.ok) return null;
  const data = await response.json();
  const mergedAt = data.merged_at ? Date.parse(data.merged_at) : null;
  return { title: String(data.title || '').slice(0, 300), state: mergedAt ? 'merged' : data.state === 'closed' ? 'closed' : 'open', merged_at: mergedAt };
}

/**
 * Re-checks open PRs on a user's features and saves any that changed (which can auto-complete the feature).
 * @param {Record<string, any>} env
 * @param {string} userId
 * @param {string[]} [noteIds] limit to these notes and skip the recheck delay
 */
export async function refreshPullRequests(env, userId, noteIds) {
  const now = Date.now();
  const query = noteIds?.length
    ? env.DB.prepare(`SELECT * FROM notes WHERE user_id = ? AND id IN (${noteIds.map(() => '?').join(', ')})`).bind(userId, ...noteIds)
    : env.DB.prepare(
      `SELECT * FROM notes WHERE user_id = ? AND kind = 'feature' AND deleted_at IS NULL AND pull_requests LIKE '%"state":"open"%'
       AND (prs_checked_at IS NULL OR prs_checked_at < ?) ORDER BY prs_checked_at ASC LIMIT ?`,
    ).bind(userId, now - RECHECK_MS, MAX_NOTES_PER_REFRESH);
  const { results } = await query.all();
  if (!results.length) return [];

  const token = await githubToken(env, userId);
  const changes = [];
  for (const row of results) {
    const before = toApi(row);
    const prs = await Promise.all(before.pull_requests.map(async (/** @type {any} */ pr) => {
      if (pr.state !== 'open') return pr;
      const latest = await fetchPullRequest(token, pr);
      return latest ? { ...pr, ...latest } : pr;
    }));
    changes.push({ before, patch: { pull_requests: prs, prs_checked_at: now } });
  }
  return saveNotes(env, userId, GITHUB_ACTOR, changes);
}

/**
 * Applies a pull_request webhook payload to every note that links that PR.
 * @param {Record<string, any>} env
 * @param {Record<string, any>} payload
 */
export async function applyPullRequestWebhook(env, payload) {
  const pull = payload.pull_request;
  if (!pull?.html_url) return 0;
  const url = String(pull.html_url);
  const mergedAt = pull.merged_at ? Date.parse(pull.merged_at) : null;
  const state = mergedAt ? 'merged' : pull.state === 'closed' ? 'closed' : 'open';
  // instr, not LIKE: D1 rejects LIKE patterns over 50 bytes and PR URLs are longer.
  const { results } = await env.DB.prepare('SELECT * FROM notes WHERE deleted_at IS NULL AND instr(pull_requests, ?) > 0').bind(JSON.stringify(url)).all();

  /** @type {Map<string, any[]>} */
  const byUser = new Map();
  for (const row of results) {
    const before = toApi(row);
    const prs = safeJson(row.pull_requests, []).map((/** @type {any} */ pr) => (pr.url === url ? { ...pr, state, merged_at: mergedAt, title: String(pull.title || pr.title).slice(0, 300) } : pr));
    const list = byUser.get(row.user_id) ?? [];
    list.push({ before, patch: { pull_requests: prs, prs_checked_at: Date.now() } });
    byUser.set(row.user_id, list);
  }
  for (const [userId, changes] of byUser) await saveNotes(env, userId, GITHUB_ACTOR, changes);
  return results.length;
}
