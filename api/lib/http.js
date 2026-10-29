// Response helpers, request body limits and CORS for every /api route.

const MAX_JSON_BYTES = 2_000_000;
// Origins of the shipped Tauri WebViews: macOS, iOS and Linux use tauri://localhost; Windows and Android use http(s)://tauri.localhost.
const NATIVE_ORIGINS = ['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost'];
const CORS_METHODS = 'GET, POST, PATCH, PUT, DELETE, OPTIONS';
const CORS_HEADERS = 'Authorization, Content-Type';
const CORS_MAX_AGE = '86400';
const NO_STORE = 'private, no-store';

/** Error that becomes a JSON response with its status, and a code the app can act on (src/lib/models.js). */
export class HttpError extends Error {
  /** @param {number} status @param {string} message @param {string} [code] */
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** @param {any} data @param {number} [status] @param {HeadersInit} [headers] */
export function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers: { 'Cache-Control': NO_STORE, ...headers } });
}

/**
 * Reads a JSON body, refusing anything over MAX_JSON_BYTES.
 * @param {Request} request
 */
export async function readJson(request) {
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > MAX_JSON_BYTES) throw new HttpError(413, 'Request body too large');
  const text = await request.text();
  if (text.length > MAX_JSON_BYTES) throw new HttpError(413, 'Request body too large');
  try {
    return JSON.parse(text || '{}');
  } catch {
    throw new HttpError(400, 'Body must be JSON');
  }
}

/**
 * Origins allowed to call the API cross-origin: the native WebViews plus ALLOWED_ORIGINS (comma separated).
 * @param {Record<string, any>} env
 */
export function allowedOrigins(env) {
  const extra = String(env.ALLOWED_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean);
  return [...NATIVE_ORIGINS, ...extra];
}

/**
 * True when a request's Origin is this site or an allowed app origin.
 * @param {Request} request
 * @param {Record<string, any>} env
 */
export function isTrustedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  return origin === new URL(request.url).origin || allowedOrigins(env).includes(origin);
}

/**
 * CORS headers for a cross-origin caller we trust. Credentials are never allowed cross-origin:
 * native apps authenticate with a bearer token instead of cookies.
 * @param {Request} request
 * @param {Record<string, any>} env
 */
export function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin || !allowedOrigins(env).includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': CORS_METHODS,
    'Access-Control-Allow-Headers': CORS_HEADERS,
    'Access-Control-Max-Age': CORS_MAX_AGE,
    Vary: 'Origin',
  };
}

/** Escapes text for the tiny HTML pages the OAuth flow shows. @param {string} text */
export const escapeHtml = (text) =>
  String(text).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
