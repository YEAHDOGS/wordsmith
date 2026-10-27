// GET /api/v1 - self-describing index so an agent handed just a token and this URL can find its way.
import { json } from '../../../lib/http.js';
import { DIFFICULTY_LABELS, FEATURE_STATES, SMALL_DIFFICULTY } from '../../../../src/lib/models.js';

const ENDPOINTS = [
  ['GET', '/api/v1/projects', 'Projects with counts of features per state.'],
  ['GET', '/api/v1/features?project=&state=requested,in_progress&analyzed=false&max_difficulty=&batch=&format=md', 'Feature requests, most important and oldest first. analyzed=false: not triaged yet. max_difficulty=2: small ones only. format=md gives a checklist.'],
  ['POST', '/api/v1/features/next', 'Claim the next requested feature: { project? }. Atomic: two agents never get the same one. 204 when the queue is empty.'],
  ['POST', '/api/v1/features', 'File a new feature request: { project, title, body, priority? (0 none, 1 low to 5 critical), labels? }.'],
  ['GET', '/api/v1/notes/:id', 'One note or feature with project, labels and PR status.'],
  ['GET', '/api/v1/notes/:id/events', 'Timestamped timeline of everything that happened to it.'],
  ['POST', '/api/v1/notes/:id/claim', 'Claim one specific requested feature. 409 if it is taken.'],
  ['PATCH', '/api/v1/notes/:id', 'Update: { state?, status?, pr_url?, body_append?, title?, body?, priority?, difficulty?, labels?, project? }.'],
  ['GET', '/api/v1/notes/:id/analysis', 'The triage of one note: difficulty, batch, analysis notes, analyzed_at. Read it before you start.'],
  ['POST', '/api/v1/notes/:id/analysis', 'Triage a note: { difficulty (1 trivial to 5 epic), batch, analysis (replaces) or analysis_append }. Write scope, files to touch, plan, blockers and work done.'],
  ['GET', '/api/v1/batches', 'Notes grouped by batch: what ships together, how much is open, which PRs carry it.'],
  ['POST', '/api/notes/:id/attachments', 'Attach an image or video: raw file as the body, Content-Type set to its type, X-File-Name header. Images up to 20 MB, videos up to 95 MB.'],
  ['GET', '/api/attachments/:attachment_id', 'Download an attachment listed on a note (same bearer token). Look at screenshots before you start.'],
  ['GET', '/api/v1/notes?q=&label=&project=', 'Plain notes and features together, with search.'],
  ['POST', '/api/v1/notes', 'Capture a plain note: { title, body, project?, labels? }.'],
];

/** @param {{ data: Record<string, any> }} context */
export function onRequestGet({ data }) {
  return json({
    app: 'wordsmith',
    you: data.actor,
    states: FEATURE_STATES,
    difficulty: DIFFICULTY_LABELS,
    triage: [
      'GET /api/v1/features?state=requested&analyzed=false finds features nobody has triaged.',
      `POST /api/v1/notes/:id/analysis with a difficulty, a batch and your notes. Difficulty ${SMALL_DIFFICULTY} (${DIFFICULTY_LABELS[SMALL_DIFFICULTY]}) or below is a small fix.`,
      'Small fixes share one batch per day (small-fixes-YYYY-MM-DD) and ship in one pull request. Larger work stays requested, analyzed but unclaimed, for the owner to discuss.',
      'GET /api/v1/batches shows what earlier agents grouped and shipped.',
    ],
    workflow: [
      'POST /api/v1/features/next to claim work (state becomes in_progress, started_at is stamped).',
      'PATCH status as you go so the human can follow along.',
      'PATCH pr_url once your pull request is open.',
      'When the PR merges on GitHub the feature completes on its own (completed_at is stamped).',
    ],
    endpoints: ENDPOINTS.map(([method, path, description]) => ({ method, path, description })),
  });
}
