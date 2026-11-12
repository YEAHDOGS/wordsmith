// Regenerates src/lib/speech-models.json: the local speech models wordsmith can download, read from the transcribe.cpp
// model catalog (the engine in src/tauri/src/speech/) at the release the app is built against. The catalog is the
// source of truth; this file only picks what the app needs and adds each file's SHA-256 from Hugging Face, which the
// desktop app builds in (src/tauri/src/speech/mod.rs) and checks after a download. Run it when TRANSCRIBE_CPP_VERSION
// changes: `node scripts/speech-catalog.js`.
import { writeFile } from 'node:fs/promises';

// Keep in step with the transcribe-cpp version in src/tauri/Cargo.toml.
const TRANSCRIBE_CPP_VERSION = '0.4.1';
const CATALOG_REPO = 'handy-computer/transcribe.cpp';
const CATALOG_LIST_URL = `https://api.github.com/repos/${CATALOG_REPO}/contents/catalog?ref=v${TRANSCRIBE_CPP_VERSION}`;
const HUGGING_FACE = 'https://huggingface.co';
const OUTPUT = new URL('../src/lib/speech-models.json', import.meta.url);
const USER_AGENT = 'wordsmith-by-DOGS';
// The quantization offered for each model: the best size-for-accuracy that every model publishes, then fallbacks.
const QUANT_ORDER = ['Q8_0', 'Q6_K', 'Q5_K_M', 'Q4_K_M', 'F16', 'F32'];
// Voice activity detection for models that can't stream: it finds where each sentence ends.
const VAD_VARIANT = 'silero-vad-v6.2';
const VAD_QUANT = 'F32';
const PARALLEL = 8;
// Hugging Face answers these for a repo that is private, gated or missing.
const NOT_PUBLIC = [401, 403, 404];

/** @param {string} url */
async function getJson(url) {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.json();
}

/**
 * The current commit of a Hugging Face model repo and the SHA-256 and size of every LFS file in it, by file name.
 * The app downloads from that commit, so a later change upstream can't make the catalog's hashes wrong. Null when the
 * repo isn't public (the catalog lists a few models before, or without, a public download).
 * @param {string} repo
 * @returns {Promise<{ revision: string, files: Map<string, { sha256: string, size: number }> } | null>}
 */
async function hashes(repo) {
  const headers = { 'User-Agent': USER_AGENT, Accept: 'application/json' };
  const info = await fetch(`${HUGGING_FACE}/api/models/${repo}`, { headers });
  if (NOT_PUBLIC.includes(info.status)) return null;
  if (!info.ok) throw new Error(`${repo} answered ${info.status}`);
  const revision = (await info.json()).sha;
  const response = await fetch(`${HUGGING_FACE}/api/models/${repo}/tree/${revision}`, { headers });
  if (!response.ok) throw new Error(`${repo} at ${revision} answered ${response.status}`);
  const entries = (await response.json()).filter((/** @type {any} */ entry) => entry.lfs?.oid);
  return { revision, files: new Map(entries.map((/** @type {any} */ entry) => [entry.path, { sha256: entry.lfs.oid, size: entry.lfs.size }])) };
}

/** One downloadable file of a catalog record, or null when it can't be downloaded. @param {any} record @param {string[]} quants preferred first */
async function download(record, quants) {
  const pick = quants.map((quant) => record.downloads.find((/** @type {any} */ file) => file.quant === quant)).find(Boolean) ?? record.downloads[0];
  const repo = pick ? await hashes(record.published_repo) : null;
  const found = repo?.files.get(pick.filename);
  if (!repo || !found) {
    console.warn(`Skipped ${record.variant}: no public download at ${record.published_repo}`);
    return null;
  }
  return { repo: record.published_repo, revision: repo.revision, file: pick.filename, quant: pick.quant, size: found.size, sha256: found.sha256 };
}

/** Runs fn over items, PARALLEL at a time, keeping order. @template T, R @param {T[]} items @param {(item: T) => Promise<R>} fn */
async function mapPooled(items, fn) {
  /** @type {R[]} */
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }));
  return results;
}

const listing = await getJson(CATALOG_LIST_URL);
const files = listing.filter((/** @type {any} */ entry) => entry.name.endsWith('.json') && !entry.name.startsWith('_'));
const records = await mapPooled(files, (/** @type {any} */ entry) => getJson(entry.download_url));

const vadRecord = records.find((record) => record.variant === VAD_VARIANT);
if (!vadRecord) throw new Error(`The catalog has no ${VAD_VARIANT}`);

const transcribers = records.filter((record) => record.capabilities?.transcribe?.supported && record.published_repo && record.downloads?.length);
const models = (await mapPooled(transcribers, async (record) => {
  const file = await download(record, QUANT_ORDER);
  if (!file) return null;
  return {
    id: record.variant,
    name: record.display_name,
    family: record.family,
    params: record.params ?? null,
    languages: record.languages ?? [],
    streaming: Boolean(record.capabilities.streaming?.supported),
    translates: Boolean(record.capabilities.translate?.supported),
    license: record.license?.display ?? '',
    ...file,
  };
})).filter(Boolean).sort((a, b) => a.family.localeCompare(b.family) || a.size - b.size);

const vad = await download(vadRecord, [VAD_QUANT]);
if (!vad) throw new Error(`${VAD_VARIANT} has no public download`);
const catalog = { version: TRANSCRIBE_CPP_VERSION, vad, models };
await writeFile(OUTPUT, `${JSON.stringify(catalog, null, 1)}\n`);
console.log(`Wrote ${models.length} speech models from transcribe.cpp v${TRANSCRIBE_CPP_VERSION} to ${OUTPUT.pathname}`);
