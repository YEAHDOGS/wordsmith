# wordsmith

wordsmith, a notes app for ai agentic dev, made by DOGS.

Built by DOGS with Vite, Svelte 5, Tailwind CSS v4, plain JavaScript, and Cloudflare Workers, D1, R2, and Pages. Database access uses native Cloudflare bindings and APIs. No ORM is used.

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
cp api/.dev.vars.example api/.dev.vars    # DEV_LOGIN=true gives a "Local dev" sign-in on localhost
npm run build
npm run cloudflare:db:migrate:local
npm run cloudflare:dev                     # http://localhost:8788, Pages Functions + local D1 + local R2
```
For hot reload, run `npm run dev` alongside it: Vite on :5173 proxies `/api` to :8788.

`api/package.json` marks `api/` as the Pages project root. Without it, `wrangler pages dev` looks for `wrangler.jsonc` next to the repo's `package.json` and silently runs with no D1 or R2 bindings.

## Cost guards (free tier)

- Workers and D1 on the free plan stop at their limits instead of billing.
- R2 (attachments) **can** bill past its free tier, so the app enforces hard caps in D1 (`storage_usage`, `api/lib/attachments.js`): 8 GB stored, 500k uploads and 5M reads a month. Past them, uploads and downloads return 507 instead of costing money. The bucket is private, and every byte goes through an authenticated Worker. Files are cached as immutable, so repeat views cost nothing.
- Login, token creation, uploads, PR refreshes and agent writes are rate limited. Queries and sync batches are bounded. The app polls once a minute, and only while visible.
- If the `ATTACHMENTS` binding is missing, attachments switch off (503) and nothing else changes.

## Layout

- `src/`: the Svelte web app (the product).
- `api/`: Cloudflare Pages Functions (`api/functions/`), SQL migrations (`api/migrations/`) and `wrangler.jsonc`. Run Wrangler from this folder.
- `src/tauri/`: the Tauri 2 native shell, when native platforms are selected.

## The three environments

Never use production data in local development or staging. Staging contains synthetic test data only. Native apps call Cloudflare APIs and never connect directly to D1.

- **Local (your laptop)**: Run Pages Functions on Workers with `npm run cloudflare:dev` (`npx wrangler pages dev ../dist` from `api/`). Wrangler uses Miniflare to simulate Workers and D1. Standalone Workers run with `npx wrangler dev`. Local D1 uses a SQLite file under `api/.wrangler/state/`; it stays on your machine and is ignored by Git. Use SQL migrations and test data.
- **Staging / Preview (pull requests and testing)**: GitHub Actions deploys branch and pull request changes to Cloudflare Pages preview deployments on Cloudflare's edge. All previews share a dedicated staging D1 database with synthetic test data; keep migrations additive and do not reset shared staging data.
- **Production (live users)**: Cloudflare Pages and Workers serve production traffic on Cloudflare's edge and use a separate production D1 database. GitHub Actions deploys production only from `master`.

Configure separate preview and production D1 bindings in Cloudflare. Set a least-privilege Cloudflare API token and account ID as GitHub repository secrets; do not commit credentials. Fork pull requests cannot access deployment secrets and are not deployed.

### Before the first deploy

Create a Pages Direct Upload project with `npx --yes wrangler pages project create` and use the `name` from `api/wrangler.jsonc`; select `master` as its production branch. Direct Upload keeps GitHub Actions as the deployment path. Create separate staging and production D1 databases, then replace the matching database ID placeholders in `api/wrangler.jsonc`. Add `CLOUDFLARE_API_TOKEN` (Pages and D1 edit access) and `CLOUDFLARE_ACCOUNT_ID` as GitHub repository secrets. The generated `deploy-cloudflare.yml` applies the environment's SQL migrations and deploys previews for branch pushes and pull requests; pushes to `master` deploy production.

For local Pages Functions and D1, run `npm install`, `npm run build`, then `npm run cloudflare:dev`. Run local SQL migrations with `npm run cloudflare:db:migrate:local`. This database is isolated from Cloudflare and is not a copy of staging or production.

## Browser support
- **The app** runs on Chrome/Edge 99+, Firefox 97+ and Safari 15.4+. Vite lowers JS and CSS to these targets in `vite.config.js`.
- **Static fallback**: older browsers (down to Chrome 40) and visitors with JS off get the plain HTML page in `index.html`, styled by `src/styles/legacy-fallback.css`.

## Native apps (Tauri 2)

Selected targets: android, ios, windows, macos, linux.

Native builds call the hosted API, so build them with `VITE_API_BASE=https://<your pages domain>`. Sign-in opens the system browser and the app polls for its session (device flow), because Google and Apple block OAuth inside embedded WebViews. `npm run tauri:dev` runs the native shell in development. `npm run tauri:build` builds for the current host. Release artifacts are produced by the manually triggered **Build apps** GitHub Actions workflow, with each selected target built on a compatible runner.
