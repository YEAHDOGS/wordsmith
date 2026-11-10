// WebCrypto helpers: random tokens, hashes, AES-GCM for stored OAuth tokens, ES256 JWTs for Apple.

const TOKEN_BYTES = 32;
const IV_BYTES = 12;
const encoder = new TextEncoder();

/** @param {ArrayBuffer | Uint8Array} bytes */
export function base64url(bytes) {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** @param {string} text */
export function fromBase64url(text) {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4)), (char) => char.charCodeAt(0));
}

/** URL-safe random secret. @param {string} [prefix] */
export function randomToken(prefix = '') {
  return prefix + base64url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
}

/** Hex SHA-256 of a string. @param {string} text */
export async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Compares two strings in constant time (their SHA-256 hex digests). @param {string} a @param {string} b */
export async function sameSecret(a, b) {
  const [left, right] = await Promise.all([sha256(a), sha256(b)]);
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

/** Hex HMAC-SHA-256 of message under a text key. @param {string} keyText @param {string} message */
export async function hmacSha256(keyText, message) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(keyText), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** PKCE S256 challenge for a verifier. @param {string} verifier */
export async function pkceChallenge(verifier) {
  return base64url(await crypto.subtle.digest('SHA-256', encoder.encode(verifier)));
}

/** @param {string} keyBase64 */
async function aesKey(keyBase64) {
  return crypto.subtle.importKey('raw', fromBase64url(keyBase64), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/**
 * Encrypts text with TOKEN_ENCRYPTION_KEY (32 random bytes, base64url). Output: iv.ciphertext
 * @param {string} text
 * @param {string} keyBase64
 */
export async function encryptText(text, keyBase64) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(keyBase64), encoder.encode(text));
  return `${base64url(iv)}.${base64url(cipher)}`;
}

/** @param {string} sealed @param {string} keyBase64 */
export async function decryptText(sealed, keyBase64) {
  const [iv, cipher] = sealed.split('.');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64url(iv) }, await aesKey(keyBase64), fromBase64url(cipher));
  return new TextDecoder().decode(plain);
}

/**
 * Signs an ES256 JWT with a PKCS#8 PEM private key (Apple's .p8 file).
 * @param {Record<string, any>} header
 * @param {Record<string, any>} payload
 * @param {string} pem
 */
export async function signEs256Jwt(header, payload, pem) {
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s|\\n/g, '')), (char) => char.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const body = `${base64url(encoder.encode(JSON.stringify(header)))}.${base64url(encoder.encode(JSON.stringify(payload)))}`;
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(body));
  return `${body}.${base64url(signature)}`;
}

/** Reads a JWT payload without checking its signature. Only for tokens fetched directly from the issuer over TLS. @param {string} jwt */
export function decodeJwtPayload(jwt) {
  return JSON.parse(new TextDecoder().decode(fromBase64url(jwt.split('.')[1] || '')));
}
