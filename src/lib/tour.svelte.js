// The guided tour's state (src/components/Tour.svelte draws it): open or not, which step, and whether this account has
// seen it on this device. It opens by itself the first time an account uses the app on a device, and again from
// Settings. Closing it, finished or not, counts as seen, and goes back to the page the tour started from.
import { router } from './router.svelte.js';

const SEEN_KEY = 'ws_tour_seen';

class Tour {
  open = $state(false);
  step = $state(0);
  /** +1 going forward, -1 going back: which way the step's text slides. */
  direction = $state(1);
  #userId = '';
  /** Where the tour started, to return to when it closes. @type {{ view: string, id: string } | null} */
  #from = null;

  /** A signed-in account: the tour opens if it hasn't been seen here yet. @param {string | undefined} userId */
  offer(userId) {
    this.#userId = userId ?? '';
    if (!this.#userId || this.open || localStorage.getItem(`${SEEN_KEY}:${this.#userId}`)) return;
    this.start();
  }

  /** Opens the tour at its first step (Settings' "View tutorial"). */
  start() {
    this.#from = { view: router.route.view, id: router.route.id };
    this.direction = 1;
    this.step = 0;
    this.open = true;
  }

  /** @param {number} index @param {number} total */
  goTo(index, total) {
    if (index < 0 || index >= total || index === this.step) return;
    this.direction = Math.sign(index - this.step);
    this.step = index;
  }

  close() {
    if (!this.open) return;
    this.open = false;
    if (this.#userId) localStorage.setItem(`${SEEN_KEY}:${this.#userId}`, '1');
    const from = this.#from;
    this.#from = null;
    if (from) router.replace(from.view, from.id);
  }
}

export const tour = new Tour();
