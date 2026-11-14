// Keeps the native apps current without getting in the way. A while after start, and every few hours after that, the
// app looks for a newer release on its own:
// - desktop (Windows, macOS, Linux): src/tauri/src/updates.rs downloads it in the background, checks its signature, and
//   holds it until you press Restart. Nothing installs while you work.
// - Android: Tauri can't install on phones, so the app compares its version with the newest GitHub release and offers
//   the new APK, which Android installs over this one (every APK is signed with the same key, see build-apps.yml).
// - desktop builds made without the signing key have no update manifest; they fall back to the Android way and offer
//   the installer for this device.
// The web app updates itself on every deploy, so none of this runs in a browser. Settings → About shows the state and a
// "Check for updates" button; UpdatePill.svelte is the quiet notice in the corner.
import { Channel, invoke } from '@tauri-apps/api/core';
import { IS_NATIVE } from './api.js';
import { APP_VERSION } from './version.js';
import { compareVersions, latestRelease, visitorPlatform } from './github-public.js';

// Long enough that start-up (sign-in, the first sync) has the network to itself.
const FIRST_CHECK_MS = 20_000;
const CHECK_EVERY_MS = 4 * 3_600_000;
// The installer each platform gets when it has to be downloaded by hand, best first.
const INSTALLERS = { android: /\.apk$/i, windows: /\.exe$/i, macos: /universal\.dmg$/i, linux: /\.AppImage$/i };
const DEV_BUILD = /dev$/;
const NO_RELEASE = 'No release found on GitHub';

/** @typedef {'idle' | 'checking' | 'downloading' | 'ready' | 'available' | 'installing' | 'current' | 'error'} UpdateStatus */

class Updates {
  /** ready: downloaded, Restart installs it. available: a newer release to download by hand (`url`). @type {UpdateStatus} */
  status = $state('idle');
  /** The newer version, as its release names it. */
  version = $state('');
  /** Download progress, 0 to 1. */
  progress = $state(0);
  /** Where a by-hand update downloads from. */
  url = $state('');
  error = $state('');
  /** The version whose notice was closed: the pill stays away until a newer one shows up. */
  dismissed = $state('');
  /** When the last check finished (ms), for Settings. */
  checkedAt = $state(0);

  /** Only native apps update themselves, and never a development build (its version is always behind). */
  supported = IS_NATIVE && !DEV_BUILD.test(APP_VERSION) && !import.meta.env.DEV && visitorPlatform() !== 'ios';
  #platform = visitorPlatform();
  /** @type {ReturnType<typeof setTimeout> | undefined} */ #timer;

  /** Starts the background checks. Safe to call more than once. */
  start() {
    if (!this.supported || this.#timer) return;
    this.#timer = setTimeout(() => this.#scheduled(), FIRST_CHECK_MS);
  }

  async #scheduled() {
    if (navigator.onLine) await this.check();
    this.#timer = setTimeout(() => this.#scheduled(), CHECK_EVERY_MS);
  }

  /**
   * Looks for a newer version now. A press of "Check for updates" asks GitHub even when a recent answer is cached.
   * @param {{ manual?: boolean }} [options]
   */
  async check({ manual = false } = {}) {
    if (!this.supported || ['checking', 'downloading', 'installing'].includes(this.status)) return;
    // Already downloaded: only a press looks again (the next restart installs what's there).
    if (this.status === 'ready' && !manual) return;
    this.status = 'checking';
    this.error = '';
    try {
      if (this.#platform !== 'android' && await this.#fetchNative()) return;
      await this.#compareWithRelease(manual);
    } catch (error) {
      this.status = 'error';
      this.error = /** @type {Error} */ (error).message || String(error);
    } finally {
      this.checkedAt = Date.now();
    }
  }

  /** Desktop: let the updater find and download a signed update. False when there is no update manifest to read. */
  async #fetchNative() {
    const onProgress = new Channel();
    onProgress.onmessage = (/** @type {number} */ fraction) => {
      this.status = 'downloading';
      this.progress = fraction;
    };
    /** @type {{ version: string, notes: string } | null} */
    let found;
    try {
      found = await invoke('update_fetch', { onProgress });
    } catch {
      // No manifest on the newest release (built without the signing key), or GitHub unreachable: compare versions instead.
      return false;
    }
    this.progress = 0;
    if (!found) {
      this.status = 'current';
      return true;
    }
    this.version = found.version;
    this.status = 'ready';
    return true;
  }

  /** Android, or a desktop build without a manifest: a newer GitHub release means an installer to download. @param {boolean} fresh */
  async #compareWithRelease(fresh) {
    const release = await latestRelease({ fresh });
    if (!release) throw new Error(NO_RELEASE);
    const match = INSTALLERS[/** @type {keyof typeof INSTALLERS} */ (this.#platform)];
    const installer = release.downloads.find((download) => match?.test(download.name));
    if (compareVersions(release.tag, APP_VERSION) <= 0 || !installer) {
      this.status = 'current';
      return;
    }
    this.version = release.tag.replace(/^v/, '');
    this.url = installer.url;
    this.status = 'available';
  }

  /** Restart into the downloaded update, or open the new installer for this device. */
  async apply() {
    if (this.status === 'available') {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(this.url);
      return;
    }
    if (this.status !== 'ready') return;
    this.status = 'installing';
    try {
      // Doesn't return on success: the app restarts into the new version.
      await invoke('update_install');
    } catch (error) {
      this.status = 'error';
      this.error = /** @type {Error} */ (error).message || String(error);
    }
  }

  /** Hides the notice for this version. Settings still offers it. */
  dismiss() {
    this.dismissed = this.version;
  }

  /** The corner notice shows for a ready or available update the user hasn't closed. */
  get showPill() {
    return (this.status === 'ready' || this.status === 'available' || this.status === 'installing') && this.dismissed !== this.version;
  }
}

export const updates = new Updates();
