// Writes build/latest.json, the update manifest the desktop apps read from the newest release
// (src/tauri/src/updates.rs; the endpoint is in src/tauri/tauri.conf.json). Each signed updater bundle in build/ (its
// .sig file sits next to it, written by `tauri build` when TAURI_SIGNING_PRIVATE_KEY is set) becomes one platform
// entry pointing at that file on the release. Run by the release job of .github/workflows/build-apps.yml.
// Usage: node scripts/update-manifest.js <release tag> [the release's current latest.json]
// A re-run that builds only some platforms keeps the others' entries from the current manifest, when it is for the
// same version. Without any signed bundle no manifest is written, and the apps fall back to comparing release tags.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeVersion, readVersion } from './version.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BUILD_DIR = join(ROOT, 'build');
const MANIFEST = join(BUILD_DIR, 'latest.json');
const REPO_URL = 'https://github.com/YEAHDOGS/wordsmith';
const SIGNATURE = '.sig';
// Updater bundles (named by scripts/collect-builds.js) and the updater's platform keys each one serves. A platform
// already filled keeps its first bundle, so the universal Mac build wins over a single-architecture one.
const BUNDLES = [
  { file: 'wordsmith-win-x64.exe', platforms: ['windows-x86_64'] },
  { file: 'wordsmith-mac-universal.app.tar.gz', platforms: ['darwin-aarch64', 'darwin-x86_64'] },
  { file: 'wordsmith-linux-x64.AppImage', platforms: ['linux-x86_64'] },
];

/** @typedef {{ signature: string, url: string }} PlatformEntry */

/** The current manifest's platforms when it is for this version, else none. @param {string | undefined} path @param {string} version */
function keptPlatforms(path, version) {
  if (!path || !existsSync(path)) return {};
  try {
    const current = JSON.parse(readFileSync(path, 'utf8'));
    return current.version === version && current.platforms ? current.platforms : {};
  } catch {
    return {};
  }
}

const [tag, currentManifest] = process.argv.slice(2);
if (!tag) throw new Error('Usage: node scripts/update-manifest.js <release tag> [current latest.json]');
const version = nativeVersion((await readVersion()).version);
if (!version) throw new Error('Could not work out the app version; no update manifest written.');

/** @type {Record<string, PlatformEntry>} */
const platforms = {};
for (const { file, platforms: keys } of BUNDLES) {
  const signature = join(BUILD_DIR, file + SIGNATURE);
  if (!existsSync(signature) || !existsSync(join(BUILD_DIR, file))) continue;
  const entry = { signature: readFileSync(signature, 'utf8').trim(), url: `${REPO_URL}/releases/download/${tag}/${file}` };
  for (const key of keys) platforms[key] ??= entry;
}

if (!Object.keys(platforms).length) {
  console.log('No signed updater bundles in build/; no update manifest written.');
} else {
  const manifest = { version, notes: `wordsmith ${tag.replace(/^v/, '')}`, pub_date: new Date().toISOString(), platforms: { ...keptPlatforms(currentManifest, version), ...platforms } };
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`build/latest.json: ${version} for ${Object.keys(manifest.platforms).join(', ')}`);
}
