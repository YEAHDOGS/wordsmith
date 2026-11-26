-- identities.email_verified: 1 when the provider vouched for identities.email. GitHub only ever gives a verified one
-- (api/lib/oauth.js keeps just the verified primary); Google and Apple say so in the profile. Buy Me a Coffee
-- memberships reach an account only through verified emails (api/lib/auth.js), so signing in with someone else's
-- unverified address can't borrow their membership. Google and Apple rows start at 0 and are set on their next sign-in
-- (api/lib/users.js).
ALTER TABLE identities ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
UPDATE identities SET email_verified = 1 WHERE provider = 'github' AND email IS NOT NULL;
