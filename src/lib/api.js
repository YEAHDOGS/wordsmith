// Fetch wrapper for the wordsmith API. The web app uses its HttpOnly session cookie; native apps send a bearer token.
import { isTauri } from '@tauri-apps/api/core';

// Native bundles have no same-origin API, so they are built with VITE_API_BASE=https://wordsmith.dogs.red.
const API_BASE = import.meta.env.VITE_API_BASE || '';
const TOKEN_KEY = 'ws_session_token';
const NO_CONTENT = 204;

export const IS_NATIVE = isTauri();

/** API error with the HTTP status attached. */
export class ApiError extends Error {
  /** @param {number} status @param {string} message */
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Session token for native apps (web relies on the cookie). */
export const sessionToken = {
  get: () => localStorage.getItem(TOKEN_KEY),
  /** @param {string | null} token */
  set: (token) => (token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY)),
};

/**
 * Calls the API and returns parsed JSON (null for 204).
 * @param {string} path
 * @param {{ method?: string, body?: any }} [options]
 */
export async function api(path, { method = 'GET', body } = {}) {
  /** @type {Record<string, string>} */
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = sessionToken.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(API_BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: API_BASE ? 'omit' : 'same-origin',
  });
  if (response.status === NO_CONTENT) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok && response.status !== 202) throw new ApiError(response.status, data.error || `Request failed (${response.status})`);
  return data;
}

/**
 * Uploads a file as the raw request body, reporting progress (fetch can't report upload progress, XHR can).
 * @param {string} path
 * @param {File} file
 * @param {(fraction: number) => void} onProgress
 * @returns {Promise<any>}
 */
export function uploadFile(path, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', API_BASE + path);
    xhr.withCredentials = !API_BASE;
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    const token = sessionToken.get();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (event) => event.lengthComputable && onProgress(event.loaded / event.total);
    xhr.onload = () => {
      const data = JSON.parse(xhr.responseText || '{}');
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(xhr.status, data.error || `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new TypeError('Network error during upload'));
    xhr.send(file);
  });
}

/**
 * URL an <img> or <video> can load. Same-origin web uses the cookie directly (and keeps video Range seeking);
 * bearer-token clients (native apps) fetch the file once into a blob URL.
 * @param {string} path
 */
export async function mediaUrl(path) {
  const token = sessionToken.get();
  if (!token && !API_BASE) return path;
  const response = await fetch(API_BASE + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) throw new ApiError(response.status, 'Could not load attachment');
  return URL.createObjectURL(await response.blob());
}

/** Absolute URL of an API path, for links the browser opens directly. @param {string} path */
export function apiUrl(path) {
  return (API_BASE || location.origin) + path;
}
