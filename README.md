# wordsmith

wordsmith, a notes app for ai agentic dev, made by DOGS.

Built by DOGS with Vite, Svelte 5, Tailwind CSS v4, plain JavaScript, and Cloudflare Workers, D1, and R2. Database access uses native Cloudflare bindings and APIs. No ORM is used.

## What it does

Google Keep style notes, labels and projects, plus feature requests that AI agents work through:

1. **You** capture a feature in a project (any device, works offline).
2. **An agent** claims it with `POST /api/v1/features/next`, which is atomic, so two agents never get the same one. State becomes *in progress* and `started_at` is stamped.
3. The agent reports `status` as it goes, attaches screenshots or videos, and links its PR with `pr_url`.
4. **You** merge the PR on GitHub. The webhook (or a poll every couple of minutes while the app is open) marks the PR merged, and the feature completes itself with `completed_at` stamped.

Every step is written to an append-only, server-stamped `note_events` timeline showing who did it (you, the agent's token name, or GitHub) and when. Open any note to see it on the timeline spine.

Sign in with GitHub, Google or Apple. Agents use personal API tokens from **Settings & agents**, which also has a copy-paste instruction block for CLAUDE.md / AGENTS.md. `GET /api/v1` describes the whole agent API.

## Getting started (local)
```
npm install
cp .dev.vars.example .dev.vars            # DEV_LOGIN=true gives a "Local dev" sign-in on localhost
npm run build
npm run cloudflare:db:migrate:local
npm run cloudflare:dev                     # http://localhost:8788, the Worker + local D1 + local R2
```
For hot reload, run `npm run dev` alongside it: Vite on :5173 proxies `/api` to :8788.

`wrangler.jsonc` sits at the repo root, so run Wrangler from there; local state lands in `.wrangler/`.

## Cost guards (free tier)

- Workers and D1 on the free plan stop at their limits instead of billing.
- R2 (attachments) **can** bill past its free tier, so the app enforces hard caps in D1 (`storage_usage`, `api/lib/attachments.js`): 8 GB stored, 500k uploads and 5M reads a month. Past them, uploads and downloads return 507 instead of costing money. The bucket is private, and every byte goes through an authenticated Worker. Files are cached as immutable, so repeat views cost nothing.
- Login, token creation, uploads, PR refreshes and agent writes are rate limited. Queries and sync batches are bounded. The app polls once a minute, and only while visible.
- If the `ATTACHMENTS` binding is missing, attachments switch off (503) and nothing else changes.

## Layout

- `src/`: the Svelte web app (the product).
- `api/`: the Cloudflare Worker. `worker.js` serves `dist/` as static assets and routes `/api/*` to the handlers in `functions/`. Also SQL migrations (`migrations/`). Its config is `wrangler.jsonc` at the repo root.
- `src/tauri/`: the Tauri 2 native shell, when native platforms are selected.

## The three environments

Never use production data in local development or staging. Staging contains synthetic test data only. Native apps call Cloudflare APIs and never connect directly to D1.

- **Local (your laptop)**: Run the Worker with `npm run cloudflare:dev` (`npx wrangler dev` from the repo root). Wrangler uses Miniflare to simulate the Worker, D1 and R2. Local D1 uses a SQLite file under `.wrangler/state/`; it stays on your machine and is ignored by Git. Use SQL migrations and test data.
- **Staging / Preview (pull requests and testing)**: Deploy the separate `wordsmith-preview` Worker by hand with `npm run cloudflare:deploy:preview`. All previews share a dedicated staging D1 database with synthetic test data; keep migrations additive and do not reset shared staging data.
- **Production (live users)**: the `wordsmith` Worker serves production traffic on Cloudflare's edge and uses a separate production D1 database. Workers Builds deploys the `wordsmith` Worker on every push to `master`.

Configure separate preview and production D1 bindings in Cloudflare. Set a least-privilege Cloudflare API token and account ID as GitHub repository secrets; do not commit credentials. Fork pull requests cannot access deployment secrets and are not deployed.

### Before the first deploy

Production is the Worker `wordsmith`, connected to `YEAHDOGS/wordsmith` through **Workers Builds**: root directory `/` (repo root, where `wrangler.jsonc` lives), build command `npm ci`, deploy command `node scripts/deploy.js`, Preview command `node scripts/preview.js`. `wrangler.jsonc` runs `npm run build` before every deploy, so `dist/` is always fresh. The build command only installs: a `wrangler deploy` there would ship every branch to production. Every pull request branch gets its own Worker Preview (`npx wrangler preview`) on the staging D1 database and R2 bucket (the `previews` block in `wrangler.jsonc`), and `scripts/preview.js` puts its URL and build link on the first line of the PR description (build secret `GITHUB_PR_TOKEN`). Never deploy production by hand; it ships only from a push to `master`. Every push to `master` deploys it. Static assets are served without invoking the Worker (`run_worker_first` is only `/api/*` and `/n/*`), so only API calls count toward the free 100k requests/day. Staging is a separate Worker, `wordsmith-preview`, deployed by hand with `npm run cloudflare:deploy:preview`. Secrets (`TOKEN_ENCRYPTION_KEY`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and the Google/Apple ones when added) are set per Worker with `npx wrangler secret put NAME` (add `--env preview` for staging).

Builds run migrations automatically: every pull request Preview applies pending migrations to staging D1 first (`scripts/preview.js`), and every production deploy from `master` applies them to production D1 first (`scripts/deploy.js`, the Workers Builds deploy command). A failed migration fails the build, so nothing deploys against an old schema. Keep migrations additive and backward compatible. To run them by hand: `npx wrangler d1 migrations apply wordsmith-staging --remote --env preview`, then `npx wrangler d1 migrations apply wordsmith-production --remote`, or the manual **Migrate Cloudflare D1** workflow (needs `CLOUDFLARE_API_TOKEN` with D1 edit and `CLOUDFLARE_ACCOUNT_ID` as repo secrets).

For the local Worker and D1, run `npm install`, then `npm run cloudflare:dev` (it builds `dist/` first). Run local SQL migrations with `npm run cloudflare:db:migrate:local`. This database is isolated from Cloudflare and is not a copy of staging or production.

## Versioning

The app version is `v1.0.0.NN`: `NN` (two digits, zero-padded, growing past 99) goes up by one for every pull request merged into `master`. Nothing is committed on merge and no workflow runs on push. Instead `scripts/version.js` works it out during `npm run build` (which Workers Builds runs on every push to `master`): it counts merged PRs into `master` through the GitHub API, using `GITHUB_PR_TOKEN` or `GITHUB_TOKEN` when set (add the same build secret to production builds to avoid the unauthenticated rate limit) and anonymous requests otherwise. Offline, it counts first-parent merge commits with git; failing that the version is `1.0.0.dev`. It never fails the build. The app reads the result as `APP_VERSION` and `LATEST_PR` from `src/lib/version.js`. Run `node scripts/version.js` to see what a build would use. `package.json` and `tauri.conf.json` keep plain three-part semver.

## Browser support
- **The app** runs on Chrome/Edge 99+, Firefox 97+ and Safari 15.4+. Vite lowers JS and CSS to these targets in `vite.config.js`.
- **Static fallback**: older browsers (down to Chrome 40) and visitors with JS off get the plain HTML page in `index.html`, styled by `src/styles/legacy-fallback.css`.

## Native apps (Tauri 2)

Selected targets: android, ios, windows, macos, linux.

Native builds call the hosted API, so build them with `VITE_API_BASE=https://<the wordsmith Worker's domain>`. Sign-in opens the system browser and the app polls for its session (device flow), because Google and Apple block OAuth inside embedded WebViews. `npm run tauri:dev` runs the native shell in development. `npm run tauri:build` builds for the current host. Every installer is copied to `build/` at the repo root with one name per platform: `wordsmith-win-x64.exe` / `.msi`, `wordsmith-mac-universal.dmg`, `wordsmith-linux-x64.AppImage` / `.deb` / `.rpm`, `wordsmith-android.apk`, `wordsmith-ios.ipa` (`build/` is gitignored). Release builds come from the manually triggered **Build apps** workflow: tick the platforms you want, and each uploads its `build/` files as an artifact.

On Windows machines with Defender's ASR rule *Block executables unless they meet prevalence, age, or trusted list criteria*, cargo's build scripts are blocked (`Access is denied. (os error 5)`). Exclude the build folder from an admin PowerShell: `Add-MpPreference -AttackSurfaceReductionOnlyExclusions "<repo>\src\tauri\target"`.
