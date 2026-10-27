// Worker entry: serves the built app (../dist) as static assets and routes /api/* to the handlers in functions/.
// Each handler file exports onRequestGet, onRequestPost, ... receiving { request, env, params, data, next, waitUntil };
// this file does the routing and middleware chaining.
// Static asset requests never reach this code (run_worker_first is /api/* only), so they are free and uncounted.
import * as apiMiddleware from './functions/api/_middleware.js';
import * as v1Middleware from './functions/api/v1/_middleware.js';
import * as health from './functions/api/health.js';
import * as sync from './functions/api/sync.js';
import * as authSession from './functions/api/auth/session.js';
import * as authDev from './functions/api/auth/dev.js';
import * as authDevice from './functions/api/auth/device/index.js';
import * as authDevicePoll from './functions/api/auth/device/poll.js';
import * as authStart from './functions/api/auth/[provider]/start.js';
import * as authCallback from './functions/api/auth/[provider]/callback.js';
import * as tokens from './functions/api/tokens/index.js';
import * as token from './functions/api/tokens/[id].js';
import * as prsRefresh from './functions/api/prs/refresh.js';
import * as githubWebhook from './functions/api/github/webhook.js';
import * as githubRepos from './functions/api/github/repos.js';
import * as githubRepo from './functions/api/github/repo.js';
import * as projectPulls from './functions/api/projects/[id]/pulls.js';
import * as noteAttachments from './functions/api/notes/[id]/attachments.js';
import * as attachment from './functions/api/attachments/[id].js';
import * as v1Index from './functions/api/v1/index.js';
import * as v1Projects from './functions/api/v1/projects.js';
import * as v1Features from './functions/api/v1/features/index.js';
import * as v1FeaturesNext from './functions/api/v1/features/next.js';
import * as v1Notes from './functions/api/v1/notes/index.js';
import * as v1Note from './functions/api/v1/notes/[id]/index.js';
import * as v1NoteEvents from './functions/api/v1/notes/[id]/events.js';
import * as v1NoteClaim from './functions/api/v1/notes/[id]/claim.js';
import * as v1NoteAnalysis from './functions/api/v1/notes/[id]/analysis.js';
import * as v1Batches from './functions/api/v1/batches.js';
import * as v1Boards from './functions/api/v1/boards.js';
import * as v1Labels from './functions/api/v1/labels.js';
import * as sharedNote from './functions/n/[id].js';
import { APP_HOST, SHARE_PATH, SHORT_HOSTS } from '../src/lib/models.js';

const API_PREFIX = '/api';
const READ_METHODS = ['GET', 'HEAD'];
const NOT_FOUND = 404;
const METHOD_NOT_ALLOWED = 405;
// 308 keeps the method and body, so an API call to a short name isn't turned into a GET.
const PERMANENT_REDIRECT = 308;
const METHOD_EXPORTS = { GET: 'onRequestGet', POST: 'onRequestPost', PATCH: 'onRequestPatch', PUT: 'onRequestPut', DELETE: 'onRequestDelete', HEAD: 'onRequestHead', OPTIONS: 'onRequestOptions' };

// [pattern, handler module, runs the /api/v1 middleware]. ":name" segments become params, like the [name] in handler file names.
/** @type {[string, any, boolean][]} */
const ROUTES = [
  ['/api/health', health, false],
  ['/api/sync', sync, false],
  ['/api/auth/session', authSession, false],
  ['/api/auth/dev', authDev, false],
  ['/api/auth/device', authDevice, false],
  ['/api/auth/device/poll', authDevicePoll, false],
  ['/api/auth/:provider/start', authStart, false],
  ['/api/auth/:provider/callback', authCallback, false],
  ['/api/tokens', tokens, false],
  ['/api/tokens/:id', token, false],
  ['/api/prs/refresh', prsRefresh, false],
  ['/api/github/webhook', githubWebhook, false],
  ['/api/github/repos', githubRepos, false],
  ['/api/github/repo', githubRepo, false],
  ['/api/projects/:id/pulls', projectPulls, false],
  ['/api/notes/:id/attachments', noteAttachments, false],
  ['/api/attachments/:id', attachment, false],
  ['/api/v1', v1Index, true],
  ['/api/v1/projects', v1Projects, true],
  ['/api/v1/features', v1Features, true],
  ['/api/v1/features/next', v1FeaturesNext, true],
  ['/api/v1/notes', v1Notes, true],
  ['/api/v1/notes/:id', v1Note, true],
  ['/api/v1/notes/:id/events', v1NoteEvents, true],
  ['/api/v1/notes/:id/claim', v1NoteClaim, true],
  ['/api/v1/notes/:id/analysis', v1NoteAnalysis, true],
  ['/api/v1/batches', v1Batches, true],
  ['/api/v1/boards', v1Boards, true],
  ['/api/v1/labels', v1Labels, true],
];

/**
 * Matches a path against a route pattern; returns its params or null.
 * @param {string} pattern
 * @param {string[]} segments
 */
function match(pattern, segments) {
  const parts = pattern.split('/').filter(Boolean);
  if (parts.length !== segments.length) return null;
  /** @type {Record<string, string>} */
  const params = {};
  for (let index = 0; index < parts.length; index++) {
    if (parts[index].startsWith(':')) params[parts[index].slice(1)] = decodeURIComponent(segments[index]);
    else if (parts[index] !== segments[index]) return null;
  }
  return params;
}

export default {
  /**
   * @param {Request} request
   * @param {Record<string, any>} env
   * @param {{ waitUntil: (promise: Promise<any>) => void }} ctx
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // Short names (ws., word., smith.dogs.red) send API and share-link requests on to the real address.
    if (SHORT_HOSTS.includes(url.hostname)) return Response.redirect(`https://${APP_HOST}${url.pathname}${url.search}`, PERMANENT_REDIRECT);
    // Public notes (/n/<id>) are server-rendered pages, outside the API's CORS and JSON error handling.
    if (url.pathname.startsWith(SHARE_PATH) && READ_METHODS.includes(request.method)) {
      // Ids are URL-safe already, so the raw segment is used as is (isId rejects anything else).
      return sharedNote.onRequestGet({ request, env, params: { id: url.pathname.slice(SHARE_PATH.length) }, waitUntil: ctx.waitUntil.bind(ctx) });
    }
    if (url.pathname !== API_PREFIX && !url.pathname.startsWith(`${API_PREFIX}/`)) return env.ASSETS.fetch(request);

    const segments = url.pathname.split('/').filter(Boolean);
    let route = null;
    /** @type {Record<string, string>} */
    let params = {};
    for (const candidate of ROUTES) {
      const found = match(candidate[0], segments);
      if (!found) continue;
      route = candidate;
      params = found;
      break;
    }
    const [, module, v1] = route ?? [null, null, false];
    const handler = module ? module[METHOD_EXPORTS[/** @type {keyof typeof METHOD_EXPORTS} */ (request.method)]] ?? module.onRequest : null;
    const final = handler ?? (() => Response.json({ error: module ? 'Method not allowed' : 'Not found' }, { status: module ? METHOD_NOT_ALLOWED : NOT_FOUND }));
    const chain = [apiMiddleware.onRequest, ...(v1 ? [v1Middleware.onRequest] : []), final];

    // One context object per request; next() runs the following middleware, then the handler.
    const context = { request, env, params, data: {}, waitUntil: ctx.waitUntil.bind(ctx), passThroughOnException() {}, next: () => Promise.resolve(new Response(null)) };
    let position = 0;
    context.next = () => chain[position++](context);
    return context.next();
  },
};
