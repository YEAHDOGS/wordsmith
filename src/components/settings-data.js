// Public GitHub lookups for Settings: the latest app release (Install app) and the signed-in user's GitHub profile.
// Both are anonymous api.github.com calls (60 an hour per visitor), so answers are cached in localStorage.

const GITHUB_API = 'https://api.github.com';
// The list (not /releases/latest) answers 200 with [] before the first release, so no 404 lands in the console
const RELEASE_URL = `${GITHUB_API}/repos/YEAHDOGS/wordsmith/releases?per_page=10`;
const RELEASE_CACHE_KEY = 'ws_release';
const RELEASE_CACHE_MS = 3_600_000;
const PROFILE_CACHE_KEY = 'ws_github_profile';
const PROFILE_CACHE_MS = 604_800_000;
const NOT_FOUND = 404;
const GITHUB_JSON = { Accept: 'application/vnd.github+json' };
/** Which release assets belong to which platform, by extension, in the order they are offered. */
const PLATFORM_ASSETS = [
  { platform: 'android', match: /\.apk$/i },
  { platform: 'windows', match: /\.(exe|msi)$/i },
  { platform: 'macos', match: /\.dmg$/i },
  { platform: 'linux', match: /\.(AppImage|deb|rpm)$/i },
];
const EXTENSION = /\.([a-z0-9]+)$/i;
const BYTES_PER_MB = 1_048_576;
// User agent tests, first match wins (Android agents also say "Linux", so it goes first)
const AGENT_PLATFORMS = /** @type {[string, RegExp][]} */ ([
  ['android', /android/i],
  ['ios', /iphone|ipad|ipod/i],
  ['windows', /windows/i],
  ['macos', /macintosh|mac os x/i],
  ['linux', /linux|x11|cros/i],
]);
// iPadOS reports itself as a Mac; touch support gives it away
const IPAD_AGENT = /macintosh/i;
const IPAD_TOUCH_POINTS = 1;
const NUMERIC_ID = /^\d+$/;

/** @typedef {{ platform: string, name: string, kind: string, url: string, mb: number }} Download */
/** @typedef {{ tag: string, url: string, publishedAt: string, downloads: Download[] }} Release */

/**
 * GETs JSON with a localStorage cache. A 404 caches null; network errors fall back to a stale copy.
 * @param {string} key @param {string} url @param {number} maxAge
 * @returns {Promise<any>}
 */
async function cachedJson(key, url, maxAge) {
  /** @type {{ at: number, url: string, value: any } | null} */
  let cached = null;
  try {
    cached = JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    cached = null;
  }
  if (cached && cached.url === url && Date.now() - cached.at < maxAge) return cached.value;
  try {
    const response = await fetch(url, { headers: GITHUB_JSON });
    if (!response.ok && response.status !== NOT_FOUND) throw new Error(`GitHub ${response.status}`);
    const value = response.ok ? await response.json() : null;
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), url, value }));
    return value;
  } catch {
    return cached?.url === url ? cached.value : null;
  }
}

/** The newest published release and its installers, grouped by platform. Null when there is none or GitHub is unreachable. @returns {Promise<Release | null>} */
export async function latestRelease() {
  const releases = await cachedJson(RELEASE_CACHE_KEY, RELEASE_URL, RELEASE_CACHE_MS);
  const release = Array.isArray(releases) ? releases.find((entry) => !entry.draft && !entry.prerelease) : null;
  if (!release?.tag_name) return null;
  /** @type {Download[]} */
  const downloads = [];
  for (const { platform, match } of PLATFORM_ASSETS) {
    for (const asset of release.assets || []) {
      if (!match.test(asset.name)) continue;
      downloads.push({ platform, name: asset.name, kind: EXTENSION.exec(asset.name)?.[1] || '', url: asset.browser_download_url, mb: asset.size / BYTES_PER_MB });
    }
  }
  return { tag: release.tag_name, url: release.html_url, publishedAt: release.published_at, downloads };
}

/** The visitor's platform from the user agent: android, ios, windows, macos, linux, or '' when unknown. */
export function visitorPlatform() {
  const agent = navigator.userAgent;
  if (IPAD_AGENT.test(agent) && navigator.maxTouchPoints > IPAD_TOUCH_POINTS) return 'ios';
  return AGENT_PLATFORMS.find(([, pattern]) => pattern.test(agent))?.[0] || '';
}

/** The GitHub profile page for a numeric GitHub user id (logins can change; ids can't). Null if it can't be looked up. @param {string} id */
export async function githubProfileUrl(id) {
  if (!NUMERIC_ID.test(id)) return null;
  const user = await cachedJson(PROFILE_CACHE_KEY, `${GITHUB_API}/user/${id}`, PROFILE_CACHE_MS);
  return typeof user?.html_url === 'string' ? user.html_url : null;
}
