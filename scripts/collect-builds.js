// Copies native build output into build/ at the repo root with one predictable name per platform,
// e.g. build/wordsmith-win-x64.exe. Used by scripts/build-platforms.js locally and by .github/workflows/build-apps.yml.
// Usage: node scripts/collect-builds.js <windows|macos|linux|android|ios>...
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = 'wordsmith';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT_DIR = join(ROOT, 'build');
const TARGET_DIR = join(ROOT, 'src/tauri/target');
const GEN_DIR = join(ROOT, 'src/tauri/gen');
const ARCH = { x64: 'x64', arm64: 'arm64' }[process.arch] ?? process.arch;

// Per platform: which produced files to keep and what to call them. First match per output name wins.
const RULES = {
  windows: [
    { from: TARGET_DIR, match: /bundle[\\/]nsis[\\/].*-setup\.exe$/, name: `${APP}-win-${ARCH}.exe` },
    { from: TARGET_DIR, match: /bundle[\\/]msi[\\/].*\.msi$/, name: `${APP}-win-${ARCH}.msi` },
  ],
  macos: [
    { from: TARGET_DIR, match: /universal-apple-darwin[\\/].*bundle[\\/]dmg[\\/].*\.dmg$/, name: `${APP}-mac-universal.dmg` },
    { from: TARGET_DIR, match: /bundle[\\/]dmg[\\/].*\.dmg$/, name: `${APP}-mac-${ARCH}.dmg` },
  ],
  linux: [
    { from: TARGET_DIR, match: /bundle[\\/]appimage[\\/].*\.AppImage$/, name: `${APP}-linux-${ARCH}.AppImage` },
    { from: TARGET_DIR, match: /bundle[\\/]deb[\\/].*\.deb$/, name: `${APP}-linux-${ARCH}.deb` },
    { from: TARGET_DIR, match: /bundle[\\/]rpm[\\/].*\.rpm$/, name: `${APP}-linux-${ARCH}.rpm` },
  ],
  android: [{ from: GEN_DIR, match: /outputs[\\/]apk[\\/].*release.*\.apk$/, name: `${APP}-android.apk` }],
  ios: [{ from: GEN_DIR, match: /\.ipa$/, name: `${APP}-ios.ipa` }],
};

/** Every file under dir, newest first, so a stale older bundle never shadows a fresh one. @param {string} dir */
function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
}

/**
 * Collects one platform's artifacts into build/. Returns the names written.
 * @param {string} platform
 */
export function collect(platform) {
  const rules = RULES[/** @type {keyof typeof RULES} */ (platform)];
  if (!rules) throw new Error(`Unknown platform "${platform}". Use one of: ${Object.keys(RULES).join(', ')}`);
  mkdirSync(OUT_DIR, { recursive: true });
  const written = [];
  for (const rule of rules) {
    if (written.includes(rule.name)) continue;
    const found = filesUnder(rule.from).find((file) => rule.match.test(file));
    if (!found) continue;
    copyFileSync(found, join(OUT_DIR, rule.name));
    written.push(rule.name);
    console.log(`build/${rule.name}  <-  ${basename(found)}`);
  }
  if (!written.length) throw new Error(`No ${platform} build output found. Did the build succeed?`);
  return written;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const platform of process.argv.slice(2)) collect(platform);
}
