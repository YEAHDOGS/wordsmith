// Turns an OAuth profile into a wordsmith user, linking providers that share a verified email.
import { encryptText } from './crypto.js';

/**
 * Finds or creates the user for a provider profile.
 * Order: existing identity, then the already signed-in user (explicit linking), then a user with the same verified email.
 * @param {Record<string, any>} env
 * @param {string} provider
 * @param {import('./oauth.js').Profile} profile
 * @param {string | null} signedInUserId
 * @param {boolean} mayCreate false while sign-up is locked (see signupLocked) and no beta password was given
 * @returns {Promise<string | null>} user id, or null when the profile needs a new account and mayCreate is false
 */
export async function upsertUserForProfile(env, provider, profile, signedInUserId, mayCreate) {
  const now = Date.now();
  const sealedToken = profile.accessToken && env.TOKEN_ENCRYPTION_KEY ? await encryptText(profile.accessToken, env.TOKEN_ENCRYPTION_KEY) : null;

  const identity = await env.DB.prepare('SELECT user_id FROM identities WHERE provider = ? AND provider_user_id = ?')
    .bind(provider, profile.providerUserId).first();
  if (identity) {
    await env.DB.batch([
      env.DB.prepare('UPDATE identities SET email = ?, access_token = COALESCE(?, access_token) WHERE provider = ? AND provider_user_id = ?')
        .bind(profile.email, sealedToken, provider, profile.providerUserId),
      env.DB.prepare('UPDATE users SET name = COALESCE(name, ?), avatar_url = COALESCE(?, avatar_url), email = COALESCE(email, ?) WHERE id = ?')
        .bind(profile.name, profile.avatarUrl, profile.email, identity.user_id),
    ]);
    return String(identity.user_id);
  }

  let userId = signedInUserId;
  if (!userId && profile.email && profile.emailVerified) {
    const match = await env.DB.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').bind(profile.email).first();
    userId = match ? String(match.id) : null;
  }

  if (!userId && !mayCreate) return null;
  const statements = [];
  if (!userId) {
    userId = crypto.randomUUID();
    statements.push(env.DB.prepare('INSERT INTO users (id, email, name, avatar_url, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(userId, profile.email, profile.name, profile.avatarUrl, now));
  }
  statements.push(env.DB.prepare('INSERT INTO identities (provider, provider_user_id, user_id, email, access_token, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(provider, profile.providerUserId, userId, profile.email, sealedToken, now));
  await env.DB.batch(statements);
  return userId;
}
