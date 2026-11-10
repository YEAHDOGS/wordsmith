// POST /api/mcp - wordsmith as a remote MCP server (Streamable HTTP, stateless, JSON responses; no SSE stream, so GET
// answers 405). One config block connects Claude Code, Codex or any MCP client: the URL plus an agent token as a
// bearer. Tools (api/lib/mcp-tools.js) run the /api/v1 handlers in-process, so auth, validation, attribution and
// limits are the REST API's own. Writes count against the same per-user limit as /api/v1 writes.
import { WRITE_LIMIT, WRITE_WINDOW_MS, agentContext } from './v1/_middleware.js';
import { json, readJson } from '../../lib/http.js';
import { rateLimit } from '../../lib/rate-limit.js';
import { TOOLS } from '../../lib/mcp-tools.js';
import { APP_VERSION } from '../../../src/lib/version.js';

// Newest first; a client asking for one of these gets it back, anything else gets the newest.
const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
const JSON_RPC = '2.0';
const ACCEPTED = 202;
const NO_CONTENT = 204;
const BAD_REQUEST = 400;
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const HANDLERS = { GET: 'onRequestGet', POST: 'onRequestPost', PATCH: 'onRequestPatch', PUT: 'onRequestPut' };
const INTERNAL_ORIGIN = 'https://mcp.internal';
// Messages in one JSON-RPC batch. They run one after another: a write costs several D1 queries and the free plan
// allows 50 per request.
const MAX_BATCH = 10;
const INSTRUCTIONS = [
  'wordsmith is the owner\'s notes and feature queue for agentic development.',
  'Start every session with get_context, then get_project_context for the project you work on.',
  'Loop: claim_next (or claim_note), update_note with status as you go, update_note pr_url once the PR is open. A merged PR completes the feature by itself.',
  'Triage with post_analysis. Prefer body_append and analysis_append over replacing text the owner wrote; every change is on the timeline under your token name.',
].join(' ');
const TOOL_LIST = TOOLS.map((tool) => ({
  name: tool.name,
  description: tool.description,
  inputSchema: { type: 'object', properties: tool.properties ?? {}, required: tool.required ?? [], additionalProperties: false },
  annotations: { readOnlyHint: tool.method === 'GET', destructiveHint: false, openWorldHint: false },
}));
const TOOLS_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

/** @param {unknown} id @param {any} result */
const reply = (id, result) => ({ jsonrpc: JSON_RPC, id, result });
/** @param {unknown} id @param {number} code @param {string} message */
const failure = (id, code, message) => ({ jsonrpc: JSON_RPC, id: id ?? null, error: { code, message } });

/**
 * Runs one tool through its /api/v1 handler and turns the answer into MCP tool content.
 * @param {Record<string, any>} context the request context, already signed in
 * @param {import('../../lib/mcp-tools.js').Tool} tool
 * @param {Record<string, any>} args
 */
async function callTool(context, tool, args) {
  const { auth } = context.data;
  /** @type {Record<string, string>} */
  const params = {};
  const path = tool.path.replace(/:(\w+)/g, (_, name) => encodeURIComponent((params[name] = String(args[name] ?? ''))));
  const url = new URL(path, INTERNAL_ORIGIN);
  const named = [...Object.keys(params), ...(tool.query ?? [])];
  for (const name of tool.query ?? []) if (args[name] !== undefined) url.searchParams.set(name, String(args[name]));
  // Only the arguments the tool declares go on, so a stray one can't reach a handler field the schema doesn't offer.
  const body = Object.fromEntries(Object.entries(args).filter(([name]) => name in (tool.properties ?? {}) && !named.includes(name)));
  const request = new Request(url, tool.method === 'GET' ? { method: 'GET' } : { method: tool.method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    // Inside the try, so a caller over the limit gets a tool error for this message and the rest of a batch still answers.
    if (tool.method !== 'GET') await rateLimit(context.env, `v1:${auth.user.id}`, WRITE_LIMIT, WRITE_WINDOW_MS);
    const response = await tool.module[HANDLERS[tool.method]]({ ...context, request, params });
    if (response.status === NO_CONTENT) return { content: [{ type: 'text', text: 'Nothing to return (for claim_next: the queue is empty).' }] };
    const text = await response.text();
    return { content: [{ type: 'text', text }], isError: !response.ok };
  } catch (error) {
    return { content: [{ type: 'text', text: /** @type {Error} */ (error).message }], isError: true };
  }
}

/**
 * One JSON-RPC message in, its answer out (null for notifications, which get no answer).
 * @param {Record<string, any>} context @param {any} message
 */
async function handle(context, message) {
  if (!message || typeof message !== 'object' || message.jsonrpc !== JSON_RPC || typeof message.method !== 'string') return failure(message?.id, INVALID_REQUEST, 'Not a JSON-RPC 2.0 request');
  const { id, method } = message;
  if (id === undefined) return null;
  if (message.params !== undefined && (message.params === null || typeof message.params !== 'object')) return failure(id, INVALID_PARAMS, 'params must be an object');
  const params = message.params ?? {};
  if (method === 'initialize') {
    const asked = params.protocolVersion;
    return reply(id, {
      protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'wordsmith', title: 'wordsmith by DOGS', version: APP_VERSION },
      instructions: INSTRUCTIONS,
    });
  }
  if (method === 'ping') return reply(id, {});
  if (method === 'tools/list') return reply(id, { tools: TOOL_LIST });
  if (method === 'tools/call') {
    const tool = TOOLS_BY_NAME.get(params.name);
    if (!tool) return failure(id, INVALID_PARAMS, `Unknown tool: ${params.name}`);
    const args = params.arguments ?? {};
    const missing = (tool.required ?? []).filter((name) => args[name] === undefined || args[name] === '');
    if (missing.length) return reply(id, { content: [{ type: 'text', text: `Missing ${missing.join(', ')}` }], isError: true });
    return reply(id, await callTool(context, tool, args));
  }
  return failure(id, METHOD_NOT_FOUND, `Method not found: ${method}`);
}

/** @param {{ request: Request, env: Record<string, any>, data: Record<string, any> }} context */
export async function onRequestPost(context) {
  await agentContext(context);
  let body;
  try {
    body = await readJson(context.request);
  } catch (error) {
    if (/** @type {any} */ (error).status !== BAD_REQUEST) throw error;
    return json(failure(null, PARSE_ERROR, 'Body must be JSON'));
  }
  const messages = Array.isArray(body) ? body : [body];
  if (messages.length > MAX_BATCH) return json(failure(null, INVALID_REQUEST, `Send at most ${MAX_BATCH} messages per batch`));
  const answers = [];
  for (const message of messages) {
    const answer = await handle(context, message);
    if (answer) answers.push(answer);
  }
  if (!answers.length) return new Response(null, { status: ACCEPTED });
  return json(Array.isArray(body) ? answers : answers[0]);
}
