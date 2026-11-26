// The Privacy Policy lives at /privacy, outside the hash router, so the link works signed out, shared, or opened cold
// (the Worker's single-page-application fallback serves index.html for it). #/privacy works too, for native shells.

export const PRIVACY_PATH = '/privacy';
const PRIVACY_HASH = '#/privacy';
const HOME_PATH = '/';
const PRIMARY_BUTTON = 0;

const atPrivacy = () => location.pathname === PRIVACY_PATH || location.hash === PRIVACY_HASH;

class PrivacyRoute {
  open = $state(atPrivacy());
  /** True while the page was pushed by us, so Back can step back through history instead of stacking it. */
  #pushed = false;

  constructor() {
    addEventListener('popstate', () => {
      this.open = atPrivacy();
      if (!this.open) this.#pushed = false;
    });
  }

  /** Opens the policy in place. Modified clicks (new tab, new window) are left to the browser. @param {MouseEvent} event */
  show(event) {
    if (event.button !== PRIMARY_BUTTON || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (this.open) return;
    history.pushState(null, '', PRIVACY_PATH);
    this.#pushed = true;
    this.open = true;
  }

  close() {
    if (this.#pushed) history.back();
    else history.replaceState(null, '', HOME_PATH);
    this.#pushed = false;
    this.open = false;
  }
}

export const privacy = new PrivacyRoute();
