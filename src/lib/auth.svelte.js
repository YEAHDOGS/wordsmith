// Sign-in state. Web logins redirect through the OAuth provider and come back with a cookie.
// Native apps open the system browser (Google and Apple block embedded WebViews) and poll for their session.
import { ApiError, IS_NATIVE, api, apiUrl, demoMode, sessionToken, whenTrialEnds } from './api.js';

const USER_CACHE_KEY = 'ws_user';
const DEVICE_POLL_MS = 2_000;
const DEVICE_GONE = 410;
// Demo mode's stand-in user. Never cached or sent anywhere.
const DEMO_USER = { id: 'demo', email: null, name: 'Demo', avatar_url: null };

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
  /** access, plan and trial_ends_at come from the server (models.js planOf); older cached users may not have them yet.
   * @type {{ id: string, email: string | null, name: string | null, avatar_url: string | null, created_at?: number, access?: string, plan?: string | null, trial_ends_at?: number, has_access?: boolean } | null} */
  user = $state(null);
  /** The server answered 402: the free trial is over. Cleared when the session is loaded again. */
  trialEnded = $state(false);
  /** @type {string[]} */ providers = $state([]);
  /** @type {{ provider: string, provider_user_id?: string, email: string | null, created_at: number }[]} */ linked = $state([]);
  devLogin = $state(false);
  /** Worker Previews: sign in with the Preview password (PREVIEW_PASSWORD, see api/lib/login.js). */
  previewLogin = $state(false);
  /** Private beta: new accounts need the beta password (SIGNUP_PASSWORD, see signupLocked in api/lib/login.js). */
  signupLocked = $state(false);
  /** True once providers and linked accounts came from the server; screens that show them load the session if not. */
  sessionFetched = $state(false);
  /** Native login in progress: the code to match in the browser. @type {{ code: string, provider: string, url: string } | null} */
  device = $state(null);
  error = $state('');
  /** Demo mode: sample data in memory, nothing synced (demoMode in api.js). */
  demo = $state(false);
  #deviceRun = 0;
  /** Counts sign outs, so a session re-read still in flight when one starts is dropped. */ #signOuts = 0;

  constructor() {
    whenTrialEnds(() => {
      if (!this.demo) this.trialEnded = true;
    });
  }

  /**
   * The free trial is over and no membership is approved: the app shows the paywall (Paywall.svelte). Only the server
   * decides: a 402 from any request, or has_access: false in a session fetched this start. Never this device's clock
   * or a cached user, so a fast clock or a stale cache can't lock out someone who has paid. A trial that runs out
   * while the app is open locks at the next sync, which answers 402.
   */
  get locked() {
    if (!this.user || this.demo) return false;
    return this.trialEnded || this.user.has_access === false;
  }

  /** When the free trial ends (ms), for the countdown in the top bar, or null when not on one. */
  get trialEndsAt() {
    const user = this.user;
    // trial_ends_at comes from the server (models.js trialEndsAt), so the end is worked out in one place.
    // Only while the trial is the best plan held: a membership that started during the trial hides the countdown.
    if (!user || this.demo || user.plan !== 'trial' || user.trial_ends_at === undefined) return null;
    return user.trial_ends_at;
  }

  /**
   * Restores the session; falls back to the cached user when offline so notes stay usable.
   * With useCache, a cached user is trusted without asking the server (one request saved per app start): the first
   * sync answers 401 if the session is gone, and names the real user if it changed. Sign-in redirects never use it.
   * @param {boolean} [useCache]
   */
  async load(useCache = false) {
    // Only a plain start resumes the demo; coming back from a real sign-in ends it.
    if (demoMode.get() && useCache) {
      this.startDemo();
      return;
    }
    this.#endDemo();
    const cached = localStorage.getItem(USER_CACHE_KEY);
    if (useCache && cached) {
      // has_access is only ever the server's word for this start (#setUser never caches it); strip it from caches
      // written before that rule, so a start from the cache can never lock.
      this.user = { ...JSON.parse(cached), has_access: undefined };
      this.status = 'signed_in';
      // Accounts on the trial, or on no plan, ask the server once in the background: a membership since the last start,
      // or the trial running out, must not wait for a refused request (a 402 from the next sync) to be noticed.
      if (this.user?.plan === 'trial' || !this.user?.plan) this.refresh();
      return;
    }
    try {
      const session = await api('/api/auth/session');
      this.providers = session.providers;
      this.devLogin = session.dev_login;
      this.previewLogin = Boolean(session.preview_login);
      this.signupLocked = Boolean(session.signup_locked);
      this.linked = session.linked || [];
      this.sessionFetched = true;
      this.#setUser(session.user);
    } catch (error) {
      if (error instanceof ApiError || !cached) {
        this.status = 'signed_out';
        this.error = error instanceof ApiError ? error.message : '';
        return;
      }
      this.user = { ...JSON.parse(cached), has_access: undefined };
      this.status = 'signed_in';
    }
  }

  /**
   * Re-reads the session quietly: a server hiccup or being offline changes nothing (never signs anyone out).
   * @returns {Promise<boolean>} whether the server answered
   */
  async refresh() {
    // A sign out that starts while this is in flight wins: its answer must not sign the user back in.
    const run = this.#signOuts;
    try {
      const session = await api('/api/auth/session');
      if (run !== this.#signOuts) return true;
      // No user is the server's answer, not a hiccup: the session ended, so back to sign in.
      if (session.user) this.#setUser(session.user);
      else this.expired();
      return true;
    } catch {
      // Offline or a server error: the cached user stays, and the server still refuses anything a locked account asks for.
      return false;
    }
  }

  /** @param {any} user */
  #setUser(user) {
    if (!user) this.#endDemo();
    this.trialEnded = false;
    this.user = user;
    this.status = user ? 'signed_in' : 'signed_out';
    // has_access is the server's word for this start only: never cached, so a start from the cache can't lock.
    if (user) localStorage.setItem(USER_CACHE_KEY, JSON.stringify({ ...user, has_access: undefined }));
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

  /** Opens the app on sample data with every server request switched off. Survives reloads until signing out. */
  startDemo() {
    demoMode.set(true);
    this.error = '';
    this.demo = true;
    this.user = DEMO_USER;
    this.status = 'signed_in';
  }

  #endDemo() {
    demoMode.set(false);
    this.demo = false;
  }

  /** Local development only (DEV_LOGIN in .dev.vars on localhost). */
  async devSignIn() {
    const { token } = await api('/api/auth/dev', { method: 'POST' });
    if (IS_NATIVE) sessionToken.set(token);
    await this.load();
  }

  /** Worker Previews only: the Preview password signs in the Preview user on staging data. @param {string} password */
  async previewSignIn(password) {
    this.error = '';
    try {
      const { token } = await api('/api/auth/preview', { method: 'POST', body: { password } });
      if (IS_NATIVE) sessionToken.set(token);
      await this.load();
    } catch (error) {
      this.error = /** @type {Error} */ (error).message;
    }
  }

  /**
   * Private beta: checks the beta password, which lets the next OAuth sign-in in this browser create an account.
   * @param {string} password
   * @returns {Promise<boolean>} false (with error set) when it was wrong
   */
  async unlockSignup(password) {
    this.error = '';
    try {
      await api('/api/auth/signup', { method: 'POST', body: { password } });
      return true;
    } catch (error) {
      this.error = /** @type {Error} */ (error).message;
      return false;
    }
  }

  async signOut() {
    this.#signOuts++;
    if (this.demo) {
      this.#setUser(null);
      return;
    }
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
