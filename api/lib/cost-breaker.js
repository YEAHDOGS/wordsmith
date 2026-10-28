// Account-wide spend breaker. R2 is the one product on this account that bills past its free tier instead of stopping,
// and its allowance (10 GB stored, 1M Class A and 10M Class B operations a month) is shared by every bucket, including
// public ones served outside this Worker. A cron (wrangler.jsonc "triggers") runs checkSpend every 10 minutes:
//   - reads this month's R2 operations and current storage for the whole account from Cloudflare's GraphQL analytics;
//   - past a limit set well under the free tier, opens the breaker: attachments refuse every R2 call (reserve() in
//     attachments.js) and every public bucket domain (custom domains and r2.dev) is switched off so nobody outside can
//     run up reads. Domains stay off until turned back on by hand; the D1 flag closes again once usage is back under.
//   - if usage can't be read for MAX_FAILURES checks in a row (token missing or revoked, API down), opens the breaker too.
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
const ROW_LIMIT = 1000;
// R2 operations that are never billed. Of the rest, Get* / Head* are Class B and anything else counts as Class A,
// so an operation Cloudflare adds later is counted at the dearer rate rather than missed.
const FREE_OPERATION = /^(Delete|Abort)/;
const CLASS_B_OPERATION = /^(Get|Head)|^UsageSummary$/;
const USAGE_QUERY = `query ($account: String!, $month: Time!, $day: Time!, $now: Time!) {
  viewer { accounts(filter: { accountTag: $account }) {
    operations: r2OperationsAdaptiveGroups(limit: ${ROW_LIMIT}, filter: { datetime_geq: $month, datetime_leq: $now }) {
      sum { requests } dimensions { actionType }
    }
    storage: r2StorageAdaptiveGroups(limit: ${ROW_LIMIT}, filter: { datetime_geq: $day, datetime_leq: $now }, orderBy: [datetime_DESC]) {
      max { payloadSize metadataSize } dimensions { bucketName datetime }
    }
  } }
}`;

/** Calls the Cloudflare API with the breaker's token; throws on any failure. @param {Record<string, any>} env @param {string} url @param {RequestInit} [init] */
async function cloudflare(env, url, init = {}) {
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${env.CF_BUDGET_TOKEN}`, 'Content-Type': 'application/json' } });
  const body = /** @type {any} */ (await response.json().catch(() => null));
  if (!response.ok || !body || body.errors?.length) throw new Error(`${url} ${response.status} ${JSON.stringify(body?.errors ?? body)}`);
  return body;
}

/** This month's billable R2 operations and current stored bytes for the whole account. @param {Record<string, any>} env */
async function readUsage(env) {
  const now = new Date();
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const variables = { account: env.CF_ACCOUNT_ID, month: month.toISOString(), day: new Date(now.getTime() - DAY_MS).toISOString(), now: now.toISOString() };
  const body = await cloudflare(env, GRAPHQL_URL, { method: 'POST', body: JSON.stringify({ query: USAGE_QUERY, variables }) });
  const account = body.data?.viewer?.accounts?.[0];
  if (!account) throw new Error('Analytics returned no account');

  const usage = { classA: 0, classB: 0, bytes: 0 };
  for (const row of account.operations) {
    const action = String(row.dimensions.actionType);
    if (FREE_OPERATION.test(action)) continue;
    if (CLASS_B_OPERATION.test(action)) usage.classB += row.sum.requests;
    else usage.classA += row.sum.requests;
  }
  // Rows are newest first: the first one per bucket is its current size.
  const seen = new Set();
  for (const row of account.storage) {
    if (seen.has(row.dimensions.bucketName)) continue;
    seen.add(row.dimensions.bucketName);
    usage.bytes += row.max.payloadSize + row.max.metadataSize;
  }
  return usage;
}

/** Switches off every public way into every bucket; returns what it switched off. @param {Record<string, any>} env */
async function closePublicBuckets(env) {
  const base = `${API_URL}/accounts/${env.CF_ACCOUNT_ID}/r2/buckets`;
  const closed = [];
  const { result } = await cloudflare(env, base);
  for (const { name } of result.buckets) {
    const managed = await cloudflare(env, `${base}/${name}/domains/managed`);
    if (managed.result.enabled) {
      await cloudflare(env, `${base}/${name}/domains/managed`, { method: 'PUT', body: JSON.stringify({ enabled: false }) });
      closed.push(managed.result.domain);
    }
    const custom = await cloudflare(env, `${base}/${name}/domains/custom`);
    for (const domain of custom.result.domains) {
      if (!domain.enabled) continue;
      await cloudflare(env, `${base}/${name}/domains/custom/${domain.domain}`, { method: 'PUT', body: JSON.stringify({ enabled: false }) });
      closed.push(domain.domain);
    }
  }
  return closed;
}

/** One breaker check; run by the cron. @param {Record<string, any>} env */
export async function checkSpend(env) {
  const now = Date.now();
  let usage;
  try {
    if (!env.CF_ACCOUNT_ID || !env.CF_BUDGET_TOKEN) throw new Error('CF_ACCOUNT_ID or CF_BUDGET_TOKEN is not set');
    usage = await readUsage(env);
  } catch (error) {
    const row = await env.DB.prepare('UPDATE cost_breaker SET failures = failures + 1 WHERE id = 1 RETURNING failures, tripped_at').first();
    console.error(`cost breaker: usage check failed (${row?.failures} in a row): ${error}`);
    if (Number(row?.failures) < MAX_FAILURES || row?.tripped_at) return;
    await env.DB.prepare('UPDATE cost_breaker SET tripped_at = ?, reason = ? WHERE id = 1')
      .bind(now, `R2 usage unreadable for ${MAX_FAILURES} checks: ${error}`).run();
    console.error('cost breaker: OPEN, R2 usage could not be confirmed');
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
  // Open the breaker in D1 first: that alone stops wordsmith, even if switching the domains off fails.
  await env.DB.prepare('UPDATE cost_breaker SET tripped_at = COALESCE(tripped_at, ?), reason = ?, failures = 0, checked_at = ? WHERE id = 1')
    .bind(now, over, now).run();
  const closed = await closePublicBuckets(env);
  if (closed.length) {
    await env.DB.prepare('UPDATE cost_breaker SET reason = reason || ? WHERE id = 1').bind(`; switched off ${closed.join(', ')}`).run();
  }
  console.error(`cost breaker: OPEN, ${over}${closed.length ? `; switched off ${closed.join(', ')}` : ''}`);
}
