// Mini Scribe (desktop apps only): the wordsmith window folds into a small strip that stays on top of every other app,
// so you can keep talking tickets into the board while you work in your editor. It is the same window and the same
// Scribe session (src/lib/scribe.svelte.js), only smaller: nothing restarts and no words are lost on the way in or out.
// Leaving puts the window back where it was, at the size it was, maximized again if it was. The strip remembers where
// it was dragged to, on this device.
import { LogicalSize, PhysicalPosition, getCurrentWindow } from '@tauri-apps/api/window';
import { IS_NATIVE } from './api.js';
import { visitorPlatform } from './github-public.js';

const DESKTOP_PLATFORMS = ['windows', 'macos', 'linux'];
// The strip's size, in logical pixels: a mic button and two lines of words beside it.
const MINI_WIDTH = 360;
const MINI_HEIGHT = 88;
// A strip with no remembered spot opens this far from the top-right corner of the screen (logical pixels).
const CORNER_GAP = 16;
// The full window's smallest size; matches minWidth and minHeight in src/tauri/tauri.conf.json.
const FULL_MIN_WIDTH = 320;
const FULL_MIN_HEIGHT = 320;
const POSITION_KEY = 'ws_mini_scribe';
const PRIMARY_BUTTON = 0;

/** @typedef {{ x: number, y: number }} Point */

/** The strip's remembered spot, in physical pixels, or null. @returns {Point | null} */
function savedPosition() {
  try {
    const point = JSON.parse(localStorage.getItem(POSITION_KEY) || 'null');
    return Number.isFinite(point?.x) && Number.isFinite(point?.y) ? point : null;
  } catch {
    return null;
  }
}

class MiniScribe {
  /** Only the desktop apps can resize and pin their window. */
  supported = IS_NATIVE && DESKTOP_PLATFORMS.includes(visitorPlatform());
  /** True while the window is the mini strip. */
  on = $state(false);
  #busy = false;
  /** @type {{ size: import('@tauri-apps/api/window').PhysicalSize, position: PhysicalPosition, maximized: boolean, fullscreen: boolean } | null} */
  #full = null;

  /** Fold the window into the strip, pinned on top. */
  async enter() {
    if (!this.supported || this.on || this.#busy) return;
    this.#busy = true;
    const win = getCurrentWindow();
    try {
      const [maximized, fullscreen] = await Promise.all([win.isMaximized(), win.isFullscreen()]);
      if (fullscreen) await win.setFullscreen(false);
      if (maximized) await win.unmaximize();
      const [size, position] = await Promise.all([win.innerSize(), win.outerPosition()]);
      this.#full = { size, position, maximized, fullscreen };
      // The strip shows first, so the full app is never squeezed into the small window on the way down.
      this.on = true;
      await win.setMinSize(null);
      await win.setDecorations(false);
      await win.setResizable(false);
      await win.setSize(new LogicalSize(MINI_WIDTH, MINI_HEIGHT));
      await win.setPosition(await this.#miniPosition(win));
      await win.setAlwaysOnTop(true);
    } catch (error) {
      console.error('Mini Scribe could not shrink the window', error);
      this.#busy = false;
      await this.exit();
      return;
    }
    this.#busy = false;
  }

  /** Put the window back the way it was. */
  async exit() {
    if (!this.on || this.#busy) return;
    this.#busy = true;
    const win = getCurrentWindow();
    const full = this.#full;
    try {
      const { x, y } = await win.outerPosition();
      localStorage.setItem(POSITION_KEY, JSON.stringify({ x, y }));
      await win.setAlwaysOnTop(false);
      await win.setResizable(true);
      await win.setDecorations(true);
      if (full) await win.setSize(full.size);
      await win.setMinSize(new LogicalSize(FULL_MIN_WIDTH, FULL_MIN_HEIGHT));
      if (full) await win.setPosition(full.position);
      if (full?.maximized) await win.maximize();
      if (full?.fullscreen) await win.setFullscreen(true);
    } catch (error) {
      console.error('Mini Scribe could not restore the window', error);
    }
    this.on = false;
    this.#full = null;
    this.#busy = false;
  }

  /** Move the strip with the pointer: the strip has no title bar to hold. @param {PointerEvent} event */
  drag(event) {
    if (event.button !== PRIMARY_BUTTON || !this.on) return;
    getCurrentWindow().startDragging();
  }

  /**
   * Where the strip goes: its remembered spot while that is still on a screen, else the top-right corner of the
   * screen the window is on.
   * @param {ReturnType<typeof getCurrentWindow>} win
   */
  async #miniPosition(win) {
    const saved = savedPosition();
    if (saved) {
      const monitors = await win.availableMonitors();
      const onScreen = monitors.some(({ workArea: { position, size } }) =>
        saved.x >= position.x && saved.y >= position.y && saved.x < position.x + size.width && saved.y < position.y + size.height);
      if (onScreen) return new PhysicalPosition(saved.x, saved.y);
    }
    const monitor = await win.currentMonitor();
    if (!monitor) return new PhysicalPosition(0, 0);
    const { position, size } = monitor.workArea;
    const scale = monitor.scaleFactor;
    return new PhysicalPosition(
      Math.round(position.x + size.width - (MINI_WIDTH + CORNER_GAP) * scale),
      Math.round(position.y + CORNER_GAP * scale));
  }
}

export const mini = new MiniScribe();
