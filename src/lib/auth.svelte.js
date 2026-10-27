// Sign-in state. Web logins redirect through the OAuth provider and come back with a cookie.
// Native apps open the system browser (Google and Apple block embedded WebViews) and poll for their session.
import { ApiError, IS_NATIVE, api, apiUrl, sessionToken } from './api.js';

const USER_CACHE_KEY = 'ws_user';
const DEVICE_POLL_MS = 2_000;
const DEVICE_GONE = 410;

/** Opens a URL in the system browser on native, or navigates on the web. @param {string} url */
async function openExternal(url) {
  if (!IS_NATIVE) {
    location.href = url;
    return;
  }
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  await openUrl(url);
}

class Auth {
  /** @type {'loading' | 'signed_out' | 'signed_in'} */
  status = $state('loading');
  /** @type {{ id: string, email: string | null, name: string | null, avatar_url: string | null } | null} */
  user = $state(null);
  /** @type {string[]} */ providers = $state([]);
  /** @type {{ provider: string, provider_user_id?: string, email: string | null, created_at: number }[]} */ linked = $state([]);
  devLogin = $state(false);
  /** True once providers and linked accounts came from the server; screens that show them load the session if not. */
  sessionFetched = $state(false);
  /** Native login in progress: the code to match in the browser. @type {{ code: string, provider: string, url: string } | null} */
  device = $state(null);
  error = $state('');
  #deviceRun = 0;

  /**
   * Restores the session; falls back to the cached user when offline so notes stay usable.
   * With useCache, a cached user is trusted without asking the server (one request saved per app start): the first
   * sync answers 401 if the session is gone, and names the real user if it changed. Sign-in redirects never use it.
   * @param {boolean} [useCache]
   */
  async load(useCache = false) {
    const cached = localStorage.getItem(USER_CACHE_KEY);
    if (useCache && cached) {
      this.user = JSON.parse(cached);
      this.status = 'signed_in';
      return;
    }
    try {
      const session = await api('/api/auth/session');
      this.providers = session.providers;
      this.devLogin = session.dev_login;
      this.linked = session.linked || [];
      this.sessionFetched = true;
      this.#setUser(session.user);
    } catch (error) {
      if (error instanceof ApiError || !cached) {
        this.status = 'signed_out';
        this.error = error instanceof ApiError ? error.message : '';
        return;
      }
      this.user = JSON.parse(cached);
      this.status = 'signed_in';
    }
  }

  /** @param {any} user */
  #setUser(user) {
    this.user = user;
    this.status = user ? 'signed_in' : 'signed_out';
    if (user) localStorage.setItem(USER_CACHE_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_CACHE_KEY);
  }

  /** @param {string} provider */
  async signIn(provider) {
    this.error = '';
    if (!IS_NATIVE) {
      location.href = apiUrl(`/api/auth/${provider}/start`);
      return;
    }
    const run = ++this.#deviceRun;
    try {
      const login = await api('/api/auth/device', { method: 'POST', body: { provider } });
      this.device = { code: login.code, provider, url: login.login_url };
      await openExternal(login.login_url);
      const deadline = Date.now() + login.expires_in_ms;
      while (run === this.#deviceRun && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, DEVICE_POLL_MS));
        const result = await api('/api/auth/device/poll', { method: 'POST', body: { device_id: login.device_id, secret: login.secret } })
          .catch((/** @type {ApiError} */ error) => (error.status === DEVICE_GONE ? { expired: true } : null));
        if (result?.expired) break;
        if (!result?.token) continue;
        sessionToken.set(result.token);
        this.device = null;
        await this.load();
        return;
      }
      if (run === this.#deviceRun) this.error = 'Sign-in timed out. Try again.';
    } catch (error) {
      this.error = /** @type {Error} */ (error).message;
    }
    if (run === this.#deviceRun) this.device = null;
  }

  cancelDevice() {
    this.#deviceRun++;
    this.device = null;
  }

  /** Local development only (DEV_LOGIN in .dev.vars on localhost). */
  async devSignIn() {
    const { token } = await api('/api/auth/dev', { method: 'POST' });
    if (IS_NATIVE) sessionToken.set(token);
    await this.load();
  }

  async signOut() {
    await api('/api/auth/session', { method: 'DELETE' }).catch(() => {});
    sessionToken.set(null);
    this.#setUser(null);
  }

  /** Server rejected our session (expired or revoked elsewhere). */
  expired() {
    sessionToken.set(null);
    this.#setUser(null);
    this.error = 'Your session ended. Sign in again.';
  }
}

export const auth = new Auth();
export { openExternal };
