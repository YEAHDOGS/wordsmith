// Mini Scribe (desktop apps only): the wordsmith window folds into a small strip that stays on top of every other app,
// so you can keep talking tickets into the board while you work in your editor. It is the same window and the same
// Scribe session (src/lib/scribe.svelte.js), only smaller: nothing restarts and no words are lost on the way in or out.
// Leaving puts the window back where it was, at the size it was, maximized again if it was. The strip remembers where
// it was dragged to, on this device.
// Linux on Wayland lets no app place or pin its own window: there the strip shrinks but stays where the compositor puts
// it, and may not stay on top.
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
// Leaving fullscreen animates on macOS and the window reports its fullscreen frame until it ends; wait this long first.
const FULLSCREEN_EXIT_MS = 800;
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

/**
 * The spot nearest (x, y), in physical pixels, that keeps the whole strip inside a screen's work area.
 * @param {import('@tauri-apps/api/window').Monitor} monitor @param {number} x @param {number} y
 */
function insideWorkArea(monitor, x, y) {
  const { position, size } = monitor.workArea;
  const width = Math.round(MINI_WIDTH * monitor.scaleFactor);
  const height = Math.round(MINI_HEIGHT * monitor.scaleFactor);
  return new PhysicalPosition(
    Math.round(Math.max(position.x, Math.min(x, position.x + size.width - width))),
    Math.round(Math.max(position.y, Math.min(y, position.y + size.height - height))));
}

class MiniScribe {
  /** Only the desktop apps can resize and pin their window. */
  supported = IS_NATIVE && DESKTOP_PLATFORMS.includes(visitorPlatform());
  /** True while the window is the mini strip. */
  on = $state(false);
  #busy = false;
  /** Asked to unfold while still folding (Escape, signing out): done as soon as the fold settles. */
  #leaveAfter = false;
  /** True once the strip reached its spot: only then is that spot worth remembering. */
  #placed = false;
  /**
   * The full window as it was, saved before the first change to it; set while there is something to put back.
   * @type {{ size: import('@tauri-apps/api/window').LogicalSize | null, position: PhysicalPosition | null, maximized: boolean, fullscreen: boolean } | null}
   */
  #full = null;

  /** Fold the window into the strip, pinned on top. */
  async enter() {
    if (!this.supported || this.on || this.#busy) return;
    this.#busy = true;
    this.#leaveAfter = false;
    const win = getCurrentWindow();
    try {
      const [maximized, fullscreen] = await Promise.all([win.isMaximized(), win.isFullscreen()]);
      this.#full = { size: null, position: null, maximized, fullscreen };
      if (fullscreen) {
        await win.setFullscreen(false);
        await new Promise((resolve) => setTimeout(resolve, FULLSCREEN_EXIT_MS));
      }
      if (maximized) await win.unmaximize();
      // The size is kept in logical pixels: the strip may be dragged to a screen with another scale before it unfolds.
      const [size, position, scale] = await Promise.all([win.innerSize(), win.outerPosition(), win.scaleFactor()]);
      Object.assign(this.#full, { size: size.toLogical(scale), position });
      // The strip shows first, so the full app is never squeezed into the small window on the way down.
      this.on = true;
      await win.setMinSize(null);
      await win.setDecorations(false);
      // Resized before it is locked: Linux ignores a new size on a window that can't be resized.
      await win.setSize(new LogicalSize(MINI_WIDTH, MINI_HEIGHT));
      await win.setPosition(await this.#miniPosition(win));
      this.#placed = true;
      await win.setResizable(false);
      await win.setAlwaysOnTop(true);
    } catch (error) {
      console.error('Mini Scribe could not shrink the window', error);
      this.#leaveAfter = true;
    }
    this.#busy = false;
    // A fold that failed partway, or an unfold asked for mid-fold, unfolds now rather than leaving a stuck strip.
    if (this.#leaveAfter) await this.exit();
  }

  /** Put the window back the way it was. */
  async exit() {
    if (this.#busy) {
      this.#leaveAfter = true;
      return;
    }
    const full = this.#full;
    if (!this.on && !full) return;
    this.#busy = true;
    this.#leaveAfter = false;
    const win = getCurrentWindow();
    if (this.#placed) {
      try {
        const { x, y } = await win.outerPosition();
        localStorage.setItem(POSITION_KEY, JSON.stringify({ x, y }));
      } catch (error) {
        console.error('Mini Scribe could not remember where the strip was', error);
      }
    }
    // Each step on its own, so one that fails still leaves the rest to put the window back. Back on its own screen
    // first, then sized, so the size is read at that screen's scale.
    const steps = [
      () => win.setAlwaysOnTop(false),
      () => win.setResizable(true),
      () => win.setDecorations(true),
      () => full?.position && win.setPosition(full.position),
      () => full?.size && win.setSize(full.size),
      () => win.setMinSize(new LogicalSize(FULL_MIN_WIDTH, FULL_MIN_HEIGHT)),
      () => full?.maximized && win.maximize(),
      () => full?.fullscreen && win.setFullscreen(true),
    ];
    for (const step of steps) {
      try {
        await step();
      } catch (error) {
        console.error('Mini Scribe could not restore the window', error);
      }
    }
    this.on = false;
    this.#placed = false;
    this.#full = null;
    this.#busy = false;
  }

  /** Move the strip with the pointer: the strip has no title bar to hold. @param {PointerEvent} event */
  drag(event) {
    if (event.button !== PRIMARY_BUTTON || !this.on) return;
    getCurrentWindow().startDragging().catch((error) => console.error('Mini Scribe could not move the strip', error));
  }

  /**
   * Where the strip goes, whole on a screen: its remembered spot while that screen is still there, else the top-right
   * corner of the screen the window is on.
   * @param {ReturnType<typeof getCurrentWindow>} win
   */
  async #miniPosition(win) {
    const saved = savedPosition();
    if (saved) {
      const monitors = await win.availableMonitors();
      const home = monitors.find(({ workArea: { position, size } }) =>
        saved.x >= position.x && saved.y >= position.y && saved.x < position.x + size.width && saved.y < position.y + size.height);
      if (home) return insideWorkArea(home, saved.x, saved.y);
    }
    const monitor = await win.currentMonitor();
    if (!monitor) return new PhysicalPosition(0, 0);
    const { position, size } = monitor.workArea;
    return insideWorkArea(monitor, position.x + size.width - (MINI_WIDTH + CORNER_GAP) * monitor.scaleFactor, position.y + CORNER_GAP * monitor.scaleFactor);
  }
}

export const mini = new MiniScribe();
