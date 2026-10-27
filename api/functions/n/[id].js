// GET /n/<id> - a public note as a standalone server-rendered page. Link unfurlers (Slack, Discord, iMessage, X,
// LinkedIn) never run the app's JavaScript, so the Open Graph and Twitter tags describing the note and its author
// are written here on the server. Only notes their owner made public are served; everything else is a plain 404.
// Responses are edge-cached for CACHE_SECONDS, so a note made private disappears within that window.
import { escapeHtml } from '../../lib/http.js';
import { isId } from '../../../src/lib/models.js';
import { plainText, renderMarkdown } from '../../../src/lib/markdown.js';
import PAGE_CSS from '../../../src/styles/public-note.css';

const CACHE_SECONDS = 60;
const SITE_NAME = 'wordsmith';
const FALLBACK_IMAGE = '/apple-touch-icon.png';
const FONTS = 'https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;600;700;900&family=JetBrains+Mono:wght@400&display=swap';
const ANONYMOUS = 'a wordsmith user';
const UNTITLED = 'Untitled note';
const STATE_LABELS = { requested: 'Requested', in_progress: 'In progress', complete: 'Complete' };
const NOT_FOUND_STATUS = 404;
const SAFE_IMAGE = /^https:\/\//i;

/**
 * @param {string} body
 * @param {number} status
 * @param {string} cacheControl
 */
const html = (body, status, cacheControl) => new Response(body, {
  status,
  headers: {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': cacheControl,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    // No scripts at all; styles inline plus Google Fonts; images from anywhere https (author avatars).
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  },
});

/** @param {string} title @param {string} head @param {string} main */
const page = (title, head, main) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${head}
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<style>${PAGE_CSS}</style>
</head>
<body>
<div class="spine" aria-hidden="true"></div>
${main}
<footer><a href="/">Written with <b>word<span>smith</span></b></a> · made by <a href="https://dogs.red">DOGS</a></footer>
</body>
</html>`;

/** @param {Record<string, string>} tags property/name -> content */
const metaTags = (tags) => Object.entries(tags)
  .filter(([, content]) => content)
  .map(([key, content]) => `<meta ${key.startsWith('og:') || key.startsWith('article:') ? 'property' : 'name'}="${key}" content="${escapeHtml(content)}">`)
  .join('\n');

const notFound = () => html(page(`Not found · ${SITE_NAME}`, '<meta name="robots" content="noindex">',
  '<main><p class="kicker">404</p><h1>This note is private or gone.</h1><p class="muted">Its owner may have made it private again.</p></main>'), NOT_FOUND_STATUS, 'no-store');

/** @param {{ request: Request, env: Record<string, any>, params: Record<string, string>, waitUntil: (promise: Promise<any>) => void }} context */
export async function onRequestGet({ request, env, params, waitUntil }) {
  if (!isId(params.id)) return notFound();
  const cache = caches.default;
  const cached = await cache.match(request);
  if (cached) return cached;

  const note = await env.DB.prepare(
    `SELECT n.id, n.kind, n.title, n.body, n.state, n.status, n.created_at, n.updated_at, u.name, u.avatar_url
     FROM notes n JOIN users u ON u.id = n.user_id WHERE n.id = ? AND n.public = 1 AND n.deleted_at IS NULL`,
  ).bind(params.id).first();
  if (!note) return notFound();

  const url = new URL(request.url);
  const canonical = `${url.origin}${url.pathname}`;
  const title = String(note.title || '').trim() || UNTITLED;
  const author = String(note.name || '').trim() || ANONYMOUS;
  const avatar = SAFE_IMAGE.test(String(note.avatar_url || '')) ? String(note.avatar_url) : '';
  const description = plainText(note.body) || `A note by ${author} on ${SITE_NAME}.`;
  const updated = new Date(Number(note.updated_at));
  const state = note.kind === 'feature' ? STATE_LABELS[/** @type {keyof typeof STATE_LABELS} */ (note.state)] ?? '' : '';

  const head = [
    `<link rel="canonical" href="${escapeHtml(canonical)}">`,
    // Shared by link, not meant for search engines: a note made private again shouldn't linger in an index.
    '<meta name="robots" content="noindex">',
    metaTags({
      description,
      author,
      'og:type': 'article',
      'og:site_name': SITE_NAME,
      'og:title': title,
      'og:description': description,
      'og:url': canonical,
      'og:image': avatar || `${url.origin}${FALLBACK_IMAGE}`,
      'og:image:alt': avatar ? `${author}'s avatar` : SITE_NAME,
      'article:author': author,
      'article:published_time': new Date(Number(note.created_at)).toISOString(),
      'article:modified_time': updated.toISOString(),
      'twitter:card': 'summary',
      'twitter:title': title,
      'twitter:description': description,
      'twitter:image': avatar || `${url.origin}${FALLBACK_IMAGE}`,
      'twitter:label1': 'Written by',
      'twitter:data1': author,
      'twitter:label2': state ? 'State' : '',
      'twitter:data2': state,
    }),
  ].join('\n');

  const main = `<main>
<header>
<p class="kicker">${state ? `Feature · <span class="state state-${escapeHtml(note.state)}">${escapeHtml(state)}</span>` : 'Note'}</p>
<h1>${escapeHtml(title)}</h1>
<p class="byline">${avatar ? `<img src="${escapeHtml(avatar)}" alt="" width="28" height="28" referrerpolicy="no-referrer">` : ''}<span>${escapeHtml(author)}</span><time datetime="${updated.toISOString()}">${updated.toUTCString().slice(0, 16)}</time></p>
${state && note.status ? `<p class="status">${escapeHtml(note.status)}</p>` : ''}
</header>
<article>${renderMarkdown(note.body)}</article>
</main>`;

  const response = html(page(`${title} · ${SITE_NAME}`, head, main), 200, `public, max-age=${CACHE_SECONDS}`);
  waitUntil(cache.put(request, response.clone()));
  return response;
}
