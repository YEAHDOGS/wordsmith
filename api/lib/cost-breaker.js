// Account-wide spend breaker. R2 is the one product on this account that bills past its free tier instead of stopping,
// and its allowance (10 GB stored, 1M Class A and 10M Class B operations a month) is shared by every bucket, including
// public ones served outside this Worker. A cron (wrangler.jsonc "triggers") runs checkSpend every 10 minutes:
//   - reads the whole account's R2 operations over the last OPERATIONS_WINDOW_MS and each bucket's recent peak storage
//     from Cloudflare's GraphQL analytics;
//   - past a limit set well under the free tier, opens the breaker: attachments refuse every upload and read (reserve()
//     in attachments.js; deletes are free and still allowed, so space can be freed) and every public bucket domain
//     (custom domains and r2.dev) is switched off so nobody outside can run up reads. Domains stay off until turned back
//     on by hand, and reason keeps the list; the D1 flag closes again once usage is back under.
//   - if usage can't be read for MAX_FAILURES checks in a row (token missing or revoked, API down), opens the breaker too.
//   - while open, every check retries switching off domains, in case one failed before.
// Needs CF_ACCOUNT_ID (var) and CF_BUDGET_TOKEN (secret: Account Analytics Read + Workers R2 Storage Write).
// Analytics run a few minutes behind and checks are 10 minutes apart, hence the margin under the free tier.

const GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql';
const API_URL = 'https://api.cloudflare.com/client/v4';
const GB = 1024 ** 3;
// Free tier: 10 GB-month, 1M Class A, 10M Class B. Trip at 80% storage and 60% of each operation class.
const MAX_STORAGE_BYTES = 8 * GB;
const MAX_CLASS_A = 600_000;
const MAX_CLASS_B = 6_000_000;
// 6 checks = an hour of not knowing what R2 is costing.
const MAX_FAILURES = 6;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
// Operations are counted over a rolling window as long as the longest billing period, not from the 1st: whatever day the
// account's billing cycle starts on, no period can hold more than this window does. Analytics allow at most 31 days.
const OPERATIONS_WINDOW_MS = 31 * DAY_MS - HOUR_MS;
// Buckets created with a jurisdiction (eu, fedramp, us) need it named on every bucket API call.
const DEFAULT_JURISDICTION = 'default';
// Storage is sampled, not reported live, and a quiet bucket may have no recent sample: take each bucket's peak over
// this window. Billing is the month's average, so the peak can only overstate it.
const STORAGE_WINDOW_DAYS = 30;
// A full page means rows were cut off and usage would be understated, so the check counts as failed instead.
const ROW_LIMIT = 1000;
const BUCKETS_PER_PAGE = 1000;
// R2 operations that are never billed. Of the rest, Get* / Head* are Class B and anything else counts as Class A,
// so an operation Cloudflare adds later is counted at the dearer rate rather than missed.
const FREE_OPERATION = /^(Delete|Abort)/;
const CLASS_B_OPERATION = /^(Get|Head)|^UsageSummary$/;
const USAGE_QUERY = `query ($account: String!, $operationsSince: Time!, $since: Time!, $now: Time!) {
  viewer { accounts(filter: { accountTag: $account }) {
    operations: r2OperationsAdaptiveGroups(limit: ${ROW_LIMIT}, filter: { datetime_geq: $operationsSince, datetime_leq: $now }) {
      sum { requests } dimensions { actionType }
    }
    storage: r2StorageAdaptiveGroups(limit: ${ROW_LIMIT}, filter: { datetime_geq: $since, datetime_leq: $now }) {
      max { payloadSize metadataSize } dimensions { bucketName }
    }
  } }
}`;

/** Calls the Cloudflare API with the breaker's token; throws on any failure. @param {Record<string, any>} env @param {string} url @param {RequestInit} [init] */
async function cloudflare(env, url, init = {}) {
  const headers = { Authorization: `Bearer ${env.CF_BUDGET_TOKEN}`, 'Content-Type': 'application/json', ...init.headers };
  const response = await fetch(url, { ...init, headers });
  const body = /** @type {any} */ (await response.json().catch(() => null));
  if (!response.ok || !body || body.errors?.length) throw new Error(`${url} ${response.status} ${JSON.stringify(body?.errors ?? body)}`);
  return body;
}

/** The account's billable R2 operations over OPERATIONS_WINDOW_MS and its stored bytes. @param {Record<string, any>} env */
async function readUsage(env) {
  const now = new Date();
  const variables = { account: env.CF_ACCOUNT_ID, operationsSince: new Date(now.getTime() - OPERATIONS_WINDOW_MS).toISOString(), since: new Date(now.getTime() - STORAGE_WINDOW_DAYS * DAY_MS).toISOString(), now: now.toISOString() };
  const body = await cloudflare(env, GRAPHQL_URL, { method: 'POST', body: JSON.stringify({ query: USAGE_QUERY, variables }) });
  const account = body.data?.viewer?.accounts?.[0];
  if (!account) throw new Error('Analytics returned no account');
  if (account.operations.length >= ROW_LIMIT || account.storage.length >= ROW_LIMIT) throw new Error('Analytics rows were truncated');

  const usage = { classA: 0, classB: 0, bytes: 0 };
  for (const row of account.operations) {
    const action = String(row.dimensions.actionType);
    if (FREE_OPERATION.test(action)) continue;
    if (CLASS_B_OPERATION.test(action)) usage.classB += row.sum.requests;
    else usage.classA += row.sum.requests;
  }
  // One row per bucket: its peak size over STORAGE_WINDOW_DAYS.
  for (const row of account.storage) usage.bytes += row.max.payloadSize + row.max.metadataSize;
  return usage;
}

/**
 * Every bucket on the account, following the list's cursor.
 * @param {Record<string, any>} env
 * @param {string} base
 * @returns {Promise<{ name: string, jurisdiction?: string }[]>}
 */
async function listBuckets(env, base) {
  const buckets = [];
  let cursor = '';
  do {
    const page = await cloudflare(env, `${base}?per_page=${BUCKETS_PER_PAGE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    buckets.push(...page.result.buckets);
    cursor = page.result_info?.cursor || '';
  } while (cursor);
  return buckets;
}

/**
 * Switches off one bucket's r2.dev and custom domains, adding each one it switched off to closed.
 * @param {Record<string, any>} env
 * @param {string} url the bucket's API URL
 * @param {Record<string, string>} headers
 * @param {string[]} closed
 */
async function closeBucket(env, url, headers, closed) {
  const off = { method: 'PUT', headers, body: JSON.stringify({ enabled: false }) };
  const managed = await cloudflare(env, `${url}/domains/managed`, { headers });
  if (managed.result.enabled) {
    await cloudflare(env, `${url}/domains/managed`, off);
    closed.push(managed.result.domain);
  }
  const custom = await cloudflare(env, `${url}/domains/custom`, { headers });
  for (const domain of custom.result.domains) {
    if (!domain.enabled) continue;
    await cloudflare(env, `${url}/domains/custom/${domain.domain}`, off);
    closed.push(domain.domain);
  }
}

/**
 * Switches off every public way into every bucket. One bucket failing doesn't stop the rest.
 * @param {Record<string, any>} env
 * @returns {Promise<{ closed: string[], failures: string[] }>} domains switched off, and what went wrong
 */
async function closePublicBuckets(env) {
  const base = `${API_URL}/accounts/${env.CF_ACCOUNT_ID}/r2/buckets`;
  /** @type {string[]} */
  const closed = [];
  /** @type {string[]} */
  const failures = [];
  const buckets = await listBuckets(env, base).catch((error) => {
    failures.push(`listing buckets: ${error}`);
    return [];
  });
  for (const { name, jurisdiction } of buckets) {
    /** @type {Record<string, string>} */
    const headers = jurisdiction && jurisdiction !== DEFAULT_JURISDICTION ? { 'cf-r2-jurisdiction': jurisdiction } : {};
    await closeBucket(env, `${base}/${name}`, headers, closed).catch((error) => failures.push(`${name}: ${error}`));
  }
  return { closed, failures };
}

/**
 * Opens the breaker, keeping the first reason while it stays open, then switches off public buckets and appends any it
 * switched off to reason (the list to turn back on by hand).
 * @param {Record<string, any>} env
 * @param {number} now
 * @param {string} why
 * @param {number | null} checkedAt set after a successful check (which also resets failures), null after a failed one
 */
async function trip(env, now, why, checkedAt) {
  // SET expressions all read the row as it was, so reason is only replaced on the closed -> open transition.
  await env.DB.prepare(
    `UPDATE cost_breaker SET tripped_at = COALESCE(tripped_at, ?1), reason = CASE WHEN tripped_at IS NULL THEN ?2 ELSE reason END,
       failures = CASE WHEN ?3 IS NULL THEN failures ELSE 0 END, checked_at = COALESCE(?3, checked_at) WHERE id = 1`,
  ).bind(now, why, checkedAt).run();
  console.error(`cost breaker: OPEN, ${why}`);
  if (!env.CF_ACCOUNT_ID || !env.CF_BUDGET_TOKEN) {
    console.error('cost breaker: cannot switch off public buckets without CF_ACCOUNT_ID and CF_BUDGET_TOKEN');
    return;
  }
  const { closed, failures } = await closePublicBuckets(env);
  if (closed.length) await env.DB.prepare('UPDATE cost_breaker SET reason = reason || ? WHERE id = 1').bind(`; switched off ${closed.join(', ')}`).run();
  if (failures.length) console.error(`cost breaker: could not switch off ${failures.join('; ')}`);
}

/** One breaker check; run by the cron. @param {Record<string, any>} env */
export async function checkSpend(env) {
  const now = Date.now();
  let usage;
  try {
    if (!env.CF_ACCOUNT_ID || !env.CF_BUDGET_TOKEN) throw new Error('CF_ACCOUNT_ID or CF_BUDGET_TOKEN is not set');
    usage = await readUsage(env);
  } catch (error) {
    const row = await env.DB.prepare('UPDATE cost_breaker SET failures = failures + 1 WHERE id = 1 RETURNING failures').first();
    console.error(`cost breaker: usage check failed (${row?.failures} in a row): ${error}`);
    if (Number(row?.failures) < MAX_FAILURES) return;
    await trip(env, now, `R2 usage unreadable for ${MAX_FAILURES} checks: ${error}`, null);
    return;
  }

  const over = [
    usage.bytes > MAX_STORAGE_BYTES && `storage ${(usage.bytes / GB).toFixed(2)} GB > ${MAX_STORAGE_BYTES / GB} GB`,
    usage.classA > MAX_CLASS_A && `Class A ${usage.classA} > ${MAX_CLASS_A}`,
    usage.classB > MAX_CLASS_B && `Class B ${usage.classB} > ${MAX_CLASS_B}`,
  ].filter(Boolean).join(', ');
  console.log(`cost breaker: storage ${(usage.bytes / GB).toFixed(2)} GB, Class A ${usage.classA}, Class B ${usage.classB}`);

  if (!over) {
    await env.DB.prepare('UPDATE cost_breaker SET tripped_at = NULL, failures = 0, checked_at = ? WHERE id = 1').bind(now).run();
    return;
  }
  // The D1 flag goes first: that alone stops wordsmith, even if switching the domains off fails.
  await trip(env, now, over, now);
}
