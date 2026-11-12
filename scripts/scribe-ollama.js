// Sets up a language model for Scribe on this machine with Ollama: `npm run scribe:ollama`.
// Scribe (src/lib/scribe.svelte.js) turns what you say into tickets by asking an OpenAI-compatible model server on your
// own machine. This script does everything that takes:
// 1. Scans for what is already here: Ollama programs, running model servers, every Ollama model folder (including
//    other projects' own, found by their Modelfiles and configs) and whether each model's files are all there.
// 2. Installs Ollama if it is missing, and starts it.
// 3. Lets wordsmith's web and desktop app talk to it (OLLAMA_ORIGINS), restarting Ollama if that changed.
// 4. Offers models: the ones already downloaded, a list picked for Scribe (scripts/scribe-ollama.json) checked live
//    against Ollama's registry for size and fit, and the newest tool-capable models on ollama.com.
// 5. Pulls the one you pick, wraps it as `wordsmith-scribe` (a longer context and steady answers; it shares the
//    downloaded weights, so it costs no disk), and tries it on a sample sentence.
// Flags: --scan only reports what is here; --list also shows the models you could pick, changing nothing;
// --yes takes every recommended answer without asking.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const CATALOG = JSON.parse(readFileSync(new URL('./scribe-ollama.json', import.meta.url), 'utf8'));
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULT_HOST = 'http://127.0.0.1:11434';
// The other servers Scribe looks for at their default addresses (LOCAL_ENDPOINTS in src/lib/scribe.svelte.js).
const OTHER_SERVERS = [{ name: 'LM Studio', url: 'http://127.0.0.1:1234/v1' }, { name: 'llama.cpp', url: 'http://127.0.0.1:8080/v1' }];
// Where wordsmith runs: the web app, and the desktop app's WebView on Windows. macOS and Linux use tauri://localhost
// and local dev uses http://localhost:5173, which Ollama allows already.
const APP_ORIGINS = ['https://wordsmith.dogs.red', 'http://tauri.localhost'];
const REGISTRY = 'https://registry.ollama.ai/v2/library';
const MANIFEST_TYPE = 'application/vnd.docker.distribution.manifest.v2+json';
const OFFICIAL_REGISTRY = 'registry.ollama.ai';
const NEWEST_PAGE = 'https://ollama.com/search?c=tools&o=newest';
const NEWEST_SHOWN = 6;
// Newest models looked at to find NEWEST_SHOWN that download: some are cloud-only, with nothing to pull.
const NEWEST_CHECKED = 16;
const HTML_ENTITIES = { '&amp;': '&', '&#39;': "'", '&quot;': '"', '&lt;': '<', '&gt;': '>' };
const DOWNLOAD_PAGE = 'https://ollama.com/download';
const LINUX_INSTALLER = 'curl -fsSL https://ollama.com/install.sh | sh';
const ALIAS = 'wordsmith-scribe';
// Scribe sends its instructions, up to 25 tickets and the speech so far: well past Ollama's small default context.
const ALIAS_CONTEXT = 16_384;
// Matches TEMPERATURE in src/lib/scribe-llm.js.
const ALIAS_TEMPERATURE = 0.2;
// Models that can't write tickets (NOT_CHAT in src/lib/scribe-llm.js).
const NOT_CHAT = /embed|whisper|rerank|tts/i;
// New models that only hear or speak; Scribe needs one that writes.
const AUDIO_ONLY = /-audio$/i;
const PROBE_TIMEOUT_MS = 2_000;
const FETCH_TIMEOUT_MS = 15_000;
const START_WAIT_MS = 30_000;
// Ollama's tray app can restart its server just after it starts, cutting off a download that began too soon.
const PULL_ATTEMPTS = 2;
const POLL_MS = 500;
const TEST_TIMEOUT_MS = 300_000;
const GB = 1e9;
// A model fits a graphics card with this much room to spare for its context; past that it spills onto the CPU.
const GPU_HEADROOM = 1.15;
// The most of this machine's memory a model may take and still leave the rest of the computer usable.
const RAM_SHARE = 0.6;
// Apple Silicon shares memory with its GPU and lets Metal use about this much of it.
const APPLE_GPU_SHARE = 0.7;
// How deep the home folder is searched for Ollama model folders and projects that use Ollama.
const SCAN_DEPTH = 5;
const SKIP_DIRS = new Set(['node_modules', '.git', 'AppData', 'Library', '.cache', '.npm', '.cargo', '.rustup', 'target', 'dist', '.wrangler', '.venv', 'venv', '__pycache__', '$Recycle.Bin']);
// Files that show a project runs its own models through Ollama.
const PROJECT_FILES = /^(Modelfile|.*\.Modelfile|stack\.json|\.env|docker-compose\.ya?ml|compose\.ya?ml|opencode.*\.json)$/i;
const USES_OLLAMA = /ollama|:11434/i;
const MAX_CONFIG_BYTES = 200_000;
const IS_WINDOWS = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const WINDOWS_USER_ENV = 'HKCU\\Environment';
const WINDOWS_MACHINE_ENV = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment';
const KNOWN_BINARIES = IS_WINDOWS
  ? [path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe'), 'C:\\Program Files\\Ollama\\ollama.exe']
  : ['/Applications/Ollama.app/Contents/Resources/ollama', '/opt/homebrew/bin/ollama', '/usr/local/bin/ollama', '/usr/bin/ollama'];
const WINDOWS_TRAY_APP = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama app.exe');
const SAMPLE_SPEECH = 'ok so the login button gets cut off on small phones, that one is urgent, and at some point we should add a dark mode switch to settings';
const SAMPLE_SYSTEM = 'Turn what the developer says into tickets. Answer with JSON only: {"actions":[{"op":"create","title":"...","body":"...","priority":"low|medium|high"}]}';

const FLAGS = new Set(process.argv.slice(2));
const SCAN_ONLY = FLAGS.has('--scan');
const LIST_ONLY = FLAGS.has('--list');
const ASSUME_YES = FLAGS.has('--yes');

const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });

/** Asks a question; with --yes (or no terminal) takes the default. @param {string} question @param {string} fallback */
async function ask(question, fallback = '') {
  if (ASSUME_YES || !process.stdin.isTTY) {
    console.log(`${question} ${fallback}`);
    return fallback;
  }
  const answer = (await prompt.question(`${question} `)).trim();
  return answer || fallback;
}

/** A yes/no question, yes by default. @param {string} question */
async function confirm(question) {
  const answer = await ask(`${question} [Y/n]`, 'y');
  return !/^n/i.test(answer);
}

/** Runs a command and returns its output, or null when it can't run. @param {string} command @param {string[]} args */
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) return null;
  return `${result.stdout}${result.stderr}`.trim();
}

/** Runs a command with its output on screen; resolves true when it succeeds. @param {string} command @param {string[]} args @param {object} [options] */
function runVisible(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit', windowsHide: true, ...options });
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });
}

/** JSON from a URL, or null. @param {string} url @param {RequestInit} [init] @param {number} [timeout] */
async function getJson(url, init = {}, timeout = PROBE_TIMEOUT_MS) {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/** An environment variable as Ollama will see it: this process, then (Windows) the saved user and machine values. @param {string} name */
function savedEnv(name) {
  if (process.env[name]) return process.env[name];
  if (!IS_WINDOWS) return '';
  for (const key of [WINDOWS_USER_ENV, WINDOWS_MACHINE_ENV]) {
    const match = run('reg', ['query', key, '/v', name])?.match(/REG_(?:EXPAND_)?SZ\s+(.*)$/m);
    if (match) return match[1].trim();
  }
  return '';
}

/** Every Ollama program on this machine, with its version. */
function findPrograms() {
  const onPath = (IS_WINDOWS ? run('where', ['ollama']) : run('which', ['-a', 'ollama']))?.split(/\r?\n/) ?? [];
  const seen = new Map();
  for (const file of [...onPath, ...KNOWN_BINARIES]) {
    if (!file || !existsSync(file)) continue;
    const key = IS_WINDOWS ? file.toLowerCase() : file;
    if (seen.has(key)) continue;
    const version = run(file, ['--version'])?.match(/(\d+\.\d+\.\d+\S*)/)?.[1] ?? '?';
    seen.set(key, { file, version });
  }
  return [...seen.values()];
}

/** The server address Ollama uses here: OLLAMA_HOST if set ("0.0.0.0:11434", "host:port" or a URL), else the default. */
function ollamaHost() {
  const value = savedEnv('OLLAMA_HOST');
  if (!value) return DEFAULT_HOST;
  const url = new URL(/^https?:\/\//.test(value) ? value : `http://${value}`);
  if (url.hostname === '0.0.0.0') url.hostname = '127.0.0.1';
  if (!url.port) url.port = '11434';
  return url.origin;
}

/**
 * Walks the home folder to SCAN_DEPTH, calling `visit` on every folder, skipping caches and dependency folders.
 * @param {string} root @param {(dir: string, entries: import('node:fs').Dirent[]) => void} visit
 */
function walk(root, visit, depth = 0) {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  visit(root, entries);
  if (depth >= SCAN_DEPTH) return;
  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
    // Hidden folders are skipped too, except Ollama's own.
    if (entry.name.startsWith('.') && entry.name !== '.ollama') continue;
    walk(path.join(root, entry.name), visit, depth + 1);
  }
}

/** Ollama model folders (the folder holding manifests/ and blobs/) and the projects that run models through Ollama. */
function scanHome() {
  const stores = new Set();
  /** @type {Map<string, string[]>} project folder → what in it mentions Ollama */
  const projects = new Map();
  for (const dir of [savedEnv('OLLAMA_MODELS'), path.join(os.homedir(), '.ollama', 'models'), '/usr/share/ollama/.ollama/models']) {
    if (dir && existsSync(path.join(dir, 'manifests'))) stores.add(path.resolve(dir));
  }
  walk(os.homedir(), (dir, entries) => {
    if (path.basename(dir) === 'manifests' && entries.some((entry) => entry.name === OFFICIAL_REGISTRY)) stores.add(path.dirname(dir));
    for (const entry of entries) {
      if (!entry.isFile() || !PROJECT_FILES.test(entry.name)) continue;
      const file = path.join(dir, entry.name);
      if (statSync(file).size > MAX_CONFIG_BYTES) continue;
      const text = readFileSync(file, 'utf8');
      if (!USES_OLLAMA.test(text) && !/^FROM\s/m.test(text)) continue;
      const project = projectRoot(dir);
      if (project === REPO_ROOT) continue;
      // The models it names: a Modelfile's FROM, and any model of the list a config mentions.
      const named = [text.match(/^FROM\s+(\S+)/m)?.[1], ...CATALOG.models.map((/** @type {{ name: string }} */ model) => model.name).filter((name) => text.includes(name))];
      const models = [...new Set(named.filter(Boolean))];
      projects.set(project, [...(projects.get(project) ?? []), `${path.relative(project, file)}${models.length ? ` (${models.join(', ')})` : ''}`]);
    }
  });
  return { stores: [...stores], projects };
}

/** The nearest folder above `dir` that looks like a project root (has .git or package.json), else `dir`. @param {string} dir */
function projectRoot(dir) {
  for (let current = dir; current !== path.dirname(current); current = path.dirname(current)) {
    if (current === os.homedir()) break;
    if (existsSync(path.join(current, '.git')) || existsSync(path.join(current, 'package.json'))) return current;
  }
  return dir;
}

/**
 * The models in one Ollama model folder, each with its size and how many of its files are missing.
 * @param {string} store @returns {{ name: string, size: number, missing: number }[]}
 */
function readStore(store) {
  const models = [];
  const manifests = path.join(store, 'manifests');
  walk(manifests, (dir, entries) => {
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      let manifest;
      try {
        manifest = JSON.parse(readFileSync(path.join(dir, entry.name), 'utf8'));
      } catch {
        continue;
      }
      const layers = [manifest.config, ...(manifest.layers ?? [])].filter(Boolean);
      const [host, namespace, ...rest] = path.relative(manifests, dir).split(path.sep);
      const repo = [...(host === OFFICIAL_REGISTRY ? [] : [host]), ...(namespace === 'library' ? [] : [namespace]), ...rest].join('/');
      models.push({
        name: `${repo}:${entry.name}`,
        size: layers.reduce((sum, layer) => sum + (layer.size || 0), 0),
        missing: layers.filter((layer) => !existsSync(path.join(store, 'blobs', layer.digest.replace(':', '-')))).length,
      });
    }
  });
  return models;
}

/**
 * The running Ollama's models. One whose files are gone still lists, but can't be shown: that marks it broken.
 * @param {string} host @returns {Promise<{ name: string, size: number, missing: number }[]>}
 */
async function servedModels(host) {
  const tags = await getJson(`${host}/api/tags`);
  return Promise.all((tags?.models ?? []).map(async (/** @type {{ name: string, size: number }} */ model) => {
    const shown = await getJson(`${host}/api/show`, { method: 'POST', body: JSON.stringify({ model: model.name }) });
    return { name: model.name, size: model.size, missing: shown ? 0 : 1 };
  }));
}

/** Graphics memory for models in bytes: NVIDIA cards through nvidia-smi, Apple Silicon's shared memory, else 0. */
function gpuMemory() {
  if (IS_MAC && process.arch === 'arm64') return { name: 'Apple Silicon (shared memory)', bytes: os.totalmem() * APPLE_GPU_SHARE };
  const line = run('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'])?.split(/\r?\n/)[0];
  if (!line) return { name: '', bytes: 0 };
  const [name, mib] = line.split(',').map((part) => part.trim());
  return { name, bytes: Number(mib) * 1024 * 1024 };
}

/** Which of `origins` the running Ollama lets in. @param {string} host @param {string[]} origins */
async function allowedOrigins(host, origins) {
  const allowed = [];
  for (const origin of origins) {
    try {
      const headers = { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' };
      const response = await fetch(`${host}/v1/chat/completions`, { method: 'OPTIONS', headers, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      if (response.headers.get('access-control-allow-origin')) allowed.push(origin);
    } catch {
      // Not answering counts as not allowed.
    }
  }
  return allowed;
}

/** Waits for Ollama to answer at `host`. @param {string} host */
async function waitForServer(host) {
  const deadline = Date.now() + START_WAIT_MS;
  while (Date.now() < deadline) {
    if (await getJson(`${host}/api/version`)) return true;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return false;
}

/** Starts Ollama in the background: the tray or menu bar app where there is one, else `ollama serve`. @param {string} program @param {Record<string, string>} env */
function startOllama(program, env) {
  const options = { detached: true, stdio: /** @type {const} */ ('ignore'), windowsHide: true, env: { ...process.env, ...env } };
  if (IS_WINDOWS && existsSync(WINDOWS_TRAY_APP)) return spawn(WINDOWS_TRAY_APP, [], options).unref();
  if (IS_MAC && existsSync('/Applications/Ollama.app')) return spawn('open', ['-a', 'Ollama'], options).unref();
  spawn(program, ['serve'], options).unref();
}

/** Stops every running Ollama (the app and its server), so it starts again with new settings. */
function stopOllama() {
  if (IS_WINDOWS) {
    run('taskkill', ['/F', '/IM', 'ollama app.exe']);
    run('taskkill', ['/F', '/IM', 'ollama.exe']);
    return;
  }
  if (IS_MAC) run('osascript', ['-e', 'tell application "Ollama" to quit']);
  run('pkill', ['-f', 'ollama serve']);
}

/** Saves OLLAMA_ORIGINS for every Ollama started from now on. Returns false where that needs a step by hand. @param {string} value */
function saveOrigins(value) {
  if (IS_WINDOWS) return run('setx', ['OLLAMA_ORIGINS', value]) !== null;
  if (IS_MAC) return run('launchctl', ['setenv', 'OLLAMA_ORIGINS', value]) !== null;
  return false;
}

/** Installs Ollama with this system's usual installer. */
async function installOllama() {
  if (IS_WINDOWS && run('winget', ['--version'])) {
    return runVisible('winget', ['install', '--id', 'Ollama.Ollama', '-e', '--accept-source-agreements', '--accept-package-agreements']);
  }
  if (IS_MAC && run('brew', ['--version'])) return runVisible('brew', ['install', '--cask', 'ollama']);
  if (!IS_WINDOWS && !IS_MAC) return runVisible('sh', ['-c', LINUX_INSTALLER]);
  console.log(`  Download it from ${DOWNLOAD_PAGE}, install it, then run this again.`);
  return false;
}

/** Size of a model on Ollama's registry in bytes, or 0 when the tag doesn't exist. @param {string} model */
async function registrySize(model) {
  const [name, tag = 'latest'] = model.split(':');
  const manifest = await getJson(`${REGISTRY}/${name}/manifests/${tag}`, { headers: { Accept: MANIFEST_TYPE } }, FETCH_TIMEOUT_MS);
  if (!manifest?.layers) return 0;
  return manifest.layers.reduce((/** @type {number} */ sum, /** @type {{ size: number }} */ layer) => sum + layer.size, 0);
}

/**
 * The newest models on ollama.com that can call tools and can be downloaded, read from its search page, with their
 * download size. Empty when the page can't be read.
 */
async function newestModels() {
  let page;
  try {
    page = await (await fetch(NEWEST_PAGE, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })).text();
  } catch {
    return [];
  }
  const seen = new Set();
  const listed = page.split('href="/library/').slice(1).map((item) => ({
    name: item.slice(0, item.indexOf('"')),
    note: (item.match(/<p[^>]*>([^<]*)<\/p>/)?.[1] ?? '').trim().replace(/&(amp|#39|quot|lt|gt);/g, (entity) => HTML_ENTITIES[/** @type {keyof typeof HTML_ENTITIES} */ (entity)]),
  })).filter((model) => model.name && !NOT_CHAT.test(model.name) && !AUDIO_ONLY.test(model.name) && !seen.has(model.name) && seen.add(model.name));
  const sized = await Promise.all(listed.slice(0, NEWEST_CHECKED).map(async (model) => ({ ...model, size: await registrySize(model.name) })));
  return sized.filter((model) => model.size).slice(0, NEWEST_SHOWN);
}

/** How a model of `size` bytes would run here. @param {number} size @param {number} gpu @param {number} ram */
function fit(size, gpu, ram) {
  if (size * GPU_HEADROOM <= gpu) return { rank: 2, label: 'fits your GPU' };
  if (size <= ram * RAM_SHARE) return { rank: 1, label: gpu ? 'runs, partly on the CPU (slower)' : 'runs on the CPU' };
  return { rank: 0, label: 'too big for this machine' };
}

/** Prints the scan and returns what was found. */
async function scan() {
  console.log('\nLooking for Ollama on this machine...');
  const programs = findPrograms();
  const host = ollamaHost();
  const version = await getJson(`${host}/api/version`);
  const others = await Promise.all(OTHER_SERVERS.map(async (server) => ({ ...server, up: Boolean(await getJson(`${server.url}/models`)) })));
  const { stores, projects } = scanHome();
  // A running Ollama knows its models best (newer versions don't keep every manifest as a file); without one, the
  // folders are read directly.
  const models = version ? await servedModels(host) : stores.flatMap((store) => readStore(store).map((model) => ({ ...model, store })));
  const gpu = gpuMemory();
  const ram = os.totalmem();

  console.log(`\n  Programs:   ${programs.length ? programs.map((program) => `${program.file} (${program.version})`).join('\n              ') : 'none'}`);
  console.log(`  Server:     ${version ? `running at ${host} (version ${version.version})` : `not running at ${host}`}`);
  for (const other of others.filter((server) => server.up)) console.log(`              ${other.name} is also running at ${other.url}; Scribe can use it too`);
  console.log(`  Machine:    ${(ram / GB).toFixed(0)} GB memory${gpu.name ? `, ${gpu.name} with ${(gpu.bytes / GB).toFixed(1)} GB for models` : ', no graphics card found for models'}`);
  console.log(`  Model folders: ${stores.length ? stores.join(', ') : 'none'}`);
  console.log(`  Models${version ? ' (as the running Ollama sees them)' : ''}: ${models.length ? '' : 'none'}`);
  for (const model of models) {
    const state = model.missing ? 'BROKEN: its files are missing, pull it again' : 'ok';
    console.log(`    ${model.name.padEnd(40)} ${(model.size / GB).toFixed(1).padStart(5)} GB  ${state}`);
  }
  if (projects.size) console.log('  Projects using Ollama:');
  for (const [project, files] of projects) console.log(`    ${project}\n      ${files.join('\n      ')}`);
  return { programs, host, running: Boolean(version), models, projects, gpu: gpu.bytes, ram };
}

/** Makes sure Ollama answers wordsmith's web and desktop app, restarting it when its allowed sites change. @param {string} program @param {string} host */
async function allowWordsmith(program, host) {
  const preview = await ask('\nPaste one PR preview URL to let previews use Ollama too (Enter to skip):', '');
  // A preview lives at <branch>-wordsmith.<account>.workers.dev: allow that account's previews, not every workers.dev site.
  const previewOrigin = preview ? `https://*.${new URL(preview).hostname.split('.').slice(1).join('.')}` : '';
  const wanted = [...APP_ORIGINS, ...(previewOrigin ? [previewOrigin] : [])];
  const probe = previewOrigin ? [...APP_ORIGINS, new URL(preview).origin] : APP_ORIGINS;
  const allowed = await allowedOrigins(host, probe);
  if (allowed.length === probe.length) return console.log('  Ollama already lets wordsmith in.');
  const saved = savedEnv('OLLAMA_ORIGINS').split(',').map((origin) => origin.trim()).filter(Boolean);
  const value = [...new Set([...saved, ...wanted])].join(',');
  console.log(`  Ollama refuses wordsmith for now. It needs OLLAMA_ORIGINS=${value}`);
  if (!saveOrigins(value)) {
    console.log('  Set it where your Ollama service reads its environment, then restart it. With systemd:');
    console.log(`    sudo systemctl edit ollama   # add: [Service] Environment="OLLAMA_ORIGINS=${value}"`);
    return console.log('    sudo systemctl restart ollama');
  }
  console.log('  Saved. Ollama has to restart to use it; models other apps have loaded will reload on their next request.');
  if (!(await confirm('  Restart Ollama now?'))) return console.log('  Restart Ollama yourself (quit it from the tray, open it again).');
  stopOllama();
  startOllama(program, { OLLAMA_ORIGINS: value });
  if (!(await waitForServer(host))) return console.log('  Ollama did not come back. Open it from the Start menu or Applications.');
  const now = await allowedOrigins(host, probe);
  console.log(now.length === probe.length ? '  Done: wordsmith is let in.' : `  Still refused: ${probe.filter((origin) => !now.includes(origin)).join(', ')}`);
}

/**
 * Lists the models to choose from and returns the picked one (nothing with --list).
 * @param {Awaited<ReturnType<typeof scan>>} found
 */
async function chooseModel(found) {
  console.log('\nChecking which models are available right now...');
  const usedBy = (/** @type {string} */ name) => [...found.projects].filter(([, files]) => files.some((file) => file.includes(name))).map(([project]) => path.relative(os.homedir(), project).split(path.sep).join('/'));
  const local = (/** @type {string} */ name) => found.models.find((model) => model.name === name || model.name === `${name}:latest`);
  const [picked, newest] = await Promise.all([
    Promise.all(CATALOG.models.map(async (/** @type {{ name: string, note: string }} */ model) => ({ ...model, size: await registrySize(model.name) }))),
    newestModels(),
  ]);
  const options = [
    ...found.models.filter((model) => !model.missing && !NOT_CHAT.test(model.name) && !model.name.startsWith(ALIAS)).map((model) => ({ name: model.name, note: 'already on this machine', size: model.size })),
    ...picked.filter((model) => model.size),
    ...newest.map((model) => ({ ...model, note: `New on ollama.com: ${model.note}` })),
  ].filter((model, index, all) => all.findIndex((other) => other.name === model.name) === index);
  if (!options.length) throw new Error('Could not reach Ollama\'s registry, and nothing usable is downloaded. Check the connection and try again.');

  const rated = options.map((model) => ({ ...model, fit: fit(model.size, found.gpu, found.ram), have: local(model.name), users: usedBy(model.name) }));
  // The best model that fits the graphics card, else the best that runs at all; one already here wins a tie of fit.
  const best = Math.max(...rated.map((model) => model.fit.rank));
  const recommended = rated.find((model) => model.fit.rank === best && model.have && !model.have.missing && picked.some((entry) => entry.name === model.name))
    ?? rated.find((model) => model.fit.rank === best && picked.some((entry) => entry.name === model.name))
    ?? rated.find((model) => model.fit.rank === best);
  console.log('');
  rated.forEach((model, index) => {
    const have = model.have ? (model.have.missing ? ' [broken here: will download again]' : ' [downloaded]') : '';
    const users = model.users.length ? ` [used by ${model.users.join(', ')}]` : '';
    const mark = model === recommended ? '*' : ' ';
    console.log(`  ${mark}${String(index + 1).padStart(2)}. ${model.name.padEnd(28)} ${(model.size / GB).toFixed(1).padStart(5)} GB  ${model.fit.label}${have}${users}`);
    console.log(`        ${model.note}`);
  });
  if (LIST_ONLY) return null;
  const answer = await ask(`\nPick a number, or type any Ollama model name [${rated.indexOf(/** @type {any} */ (recommended)) + 1}: ${recommended?.name}]:`, String(rated.indexOf(/** @type {any} */ (recommended)) + 1));
  const chosen = /^\d+$/.test(answer) ? rated[Number(answer) - 1] : { name: answer, have: local(answer) };
  if (!chosen?.name) throw new Error(`No model number ${answer}.`);
  return chosen;
}

/** Wraps the model as ALIAS for Scribe: same weights, longer context, steady answers. @param {string} program @param {string} model */
async function makeAlias(program, model) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'wordsmith-scribe-'));
  const modelfile = path.join(dir, 'Modelfile');
  writeFileSync(modelfile, `FROM ${model}\nPARAMETER num_ctx ${ALIAS_CONTEXT}\nPARAMETER temperature ${ALIAS_TEMPERATURE}\n`);
  try {
    return await runVisible(program, ['create', ALIAS, '-f', modelfile]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Asks the model for tickets from a sample sentence, the way Scribe does, and prints what came back. @param {string} host @param {string} model */
async function tryModel(host, model) {
  console.log(`\nTrying ${model} on: "${SAMPLE_SPEECH}"`);
  const started = Date.now();
  const body = { model, temperature: ALIAS_TEMPERATURE, stream: false, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: SAMPLE_SYSTEM }, { role: 'user', content: SAMPLE_SPEECH }] };
  const reply = await getJson(`${host}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, TEST_TIMEOUT_MS);
  const content = reply?.choices?.[0]?.message?.content;
  if (!content) return console.log('  No answer. Check `ollama ps` and the Ollama log.');
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  try {
    const actions = JSON.parse(content).actions ?? [];
    console.log(`  ${actions.length} ticket(s) in ${seconds}s (the first answer includes loading the model):`);
    for (const action of actions) console.log(`    - [${action.priority ?? '?'}] ${action.title}`);
  } catch {
    console.log(`  Answered in ${seconds}s, but not in JSON: ${content.slice(0, 200)}`);
  }
}

async function main() {
  const found = await scan();
  if (SCAN_ONLY) return;
  if (LIST_ONLY) return chooseModel(found);

  let program = found.programs[0]?.file;
  if (!program) {
    if (!(await confirm('\nOllama is not installed. Install it now?'))) return;
    if (!(await installOllama())) throw new Error('The install did not finish.');
    program = findPrograms()[0]?.file;
    if (!program) throw new Error('Installed, but the program is not where expected. Open a new terminal and run this again.');
  }
  if (!found.running) {
    console.log('\nStarting Ollama...');
    startOllama(program, {});
    if (!(await waitForServer(found.host))) throw new Error(`Ollama did not answer at ${found.host}. Start it by hand and run this again.`);
  }
  await allowWordsmith(program, found.host);

  const chosen = await chooseModel(found);
  if (!chosen) return;
  if (!chosen.have || chosen.have.missing) {
    console.log(`\nDownloading ${chosen.name}...`);
    let pulled = false;
    for (let attempt = 1; attempt <= PULL_ATTEMPTS && !pulled; attempt++) {
      pulled = (await waitForServer(found.host)) && (await runVisible(program, ['pull', chosen.name]));
      if (!pulled && attempt < PULL_ATTEMPTS) console.log('  Trying again (a download picks up where it stopped)...');
    }
    if (!pulled) throw new Error(`Downloading ${chosen.name} failed. Run \`ollama pull ${chosen.name}\` to see why, then run this again.`);
  }
  console.log(`\nMaking ${ALIAS} from ${chosen.name}...`);
  const aliased = await makeAlias(program, chosen.name);
  const model = aliased ? ALIAS : chosen.name;
  await tryModel(found.host, model);

  console.log('\nIn wordsmith, open Scribe\'s settings and use:');
  console.log(`  Server: ${found.host.replace('127.0.0.1', 'localhost')}/v1`);
  console.log(`  Model:  ${model}`);
  console.log('Scribe also finds a running Ollama by itself and lists its models.');
}

main()
  .catch((error) => {
    console.error(`\n${error.message || error}`);
    process.exitCode = 1;
  })
  .finally(() => prompt.close());
