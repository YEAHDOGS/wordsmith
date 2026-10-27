// Builds the selected native targets this host can build, then copies each result into build/ (see collect-builds.js).
// Usage: node scripts/build-platforms.js android ios windows macos linux
import { spawnSync } from 'node:child_process';
import { collect } from './collect-builds.js';

const COMMANDS = { android: ['tauri', 'android', ['build', '--apk']], ios: ['tauri', 'ios', ['build']], macos: ['tauri', 'build', []], windows: ['tauri', 'build', []], linux: ['tauri', 'build', []] };
// Desktop targets can only be built on their own OS; mobile needs its SDKs (Android anywhere, iOS on macOS).
const HOSTS = { windows: 'win32', macos: 'darwin', linux: 'linux', ios: 'darwin' };

const selected = process.argv.slice(2).filter((platform) => Object.hasOwn(COMMANDS, platform));
for (const platform of selected) {
  const host = HOSTS[/** @type {keyof typeof HOSTS} */ (platform)];
  if (host && host !== process.platform) {
    console.log(`Skipping ${platform}: it builds on ${host}, this is ${process.platform}. Use the Build apps workflow.`);
    continue;
  }
  const [command, subcommand, args] = COMMANDS[/** @type {keyof typeof COMMANDS} */ (platform)];
  const result = spawnSync('npx', [command, subcommand, ...args], { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) process.exit(result.status ?? 1);
  collect(platform);
}
