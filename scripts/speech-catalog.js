// Regenerates src/lib/speech-models.json: the local speech models wordsmith can download, read from the transcribe.cpp
// model catalog (the engine in src/tauri/src/speech.rs) at the release the app is built against. The catalog is the
// source of truth; this file only picks what the app needs and adds each file's SHA-256 from Hugging Face, which the
// app checks after a download. Run it when TRANSCRIBE_CPP_VERSION changes: `node scripts/speech-catalog.js`.
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
 * SHA-256 of every LFS file in a Hugging Face model repo, by file name. Null when the repo isn't public (the catalog
 * lists a few models before, or without, a public download).
 * @param {string} repo
 */
async function hashes(repo) {
  const response = await fetch(`${HUGGING_FACE}/api/models/${repo}/tree/main`, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  if (NOT_PUBLIC.includes(response.status)) return null;
  if (!response.ok) throw new Error(`${repo} answered ${response.status}`);
  return new Map((await response.json()).filter((/** @type {any} */ entry) => entry.lfs?.oid).map((/** @type {any} */ entry) => [entry.path, entry.lfs.oid]));
}

/** One downloadable file of a catalog record, or null when it can't be downloaded. @param {any} record @param {string[]} quants preferred first */
async function download(record, quants) {
  const pick = quants.map((quant) => record.downloads.find((/** @type {any} */ file) => file.quant === quant)).find(Boolean) ?? record.downloads[0];
  const sha256 = pick && (await hashes(record.published_repo))?.get(pick.filename);
  if (!sha256) {
    console.warn(`Skipped ${record.variant}: no public download at ${record.published_repo}`);
    return null;
  }
  return { repo: record.published_repo, file: pick.filename, quant: pick.quant, size: pick.size_bytes, sha256 };
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
