// GET /api/v1 - self-describing index so an agent handed just a token and this URL can find its way.
import { json } from '../../../lib/http.js';
import { FEATURE_STATES } from '../../../../src/lib/models.js';

const ENDPOINTS = [
  ['GET', '/api/v1/projects', 'Projects with counts of features per state.'],
  ['GET', '/api/v1/features?project=&state=requested,in_progress&format=md', 'Feature requests, most important and oldest first. format=md gives a checklist.'],
  ['POST', '/api/v1/features/next', 'Claim the next requested feature: { project? }. Atomic: two agents never get the same one. 204 when the queue is empty.'],
  ['POST', '/api/v1/features', 'File a new feature request: { project, title, body, priority?, labels? }.'],
  ['GET', '/api/v1/notes/:id', 'One note or feature with project, labels and PR status.'],
  ['GET', '/api/v1/notes/:id/events', 'Timestamped timeline of everything that happened to it.'],
  ['POST', '/api/v1/notes/:id/claim', 'Claim one specific requested feature. 409 if it is taken.'],
  ['PATCH', '/api/v1/notes/:id', 'Update: { state?, status?, pr_url?, body_append?, title?, body?, priority?, labels?, project? }.'],
  ['GET', '/api/v1/notes?q=&label=&project=', 'Plain notes and features together, with search.'],
  ['POST', '/api/v1/notes', 'Capture a plain note: { title, body, project?, labels? }.'],
];

/** @param {{ data: Record<string, any> }} context */
export function onRequestGet({ data }) {
  return json({
    app: 'wordsmith',
    you: data.actor,
    states: FEATURE_STATES,
    workflow: [
      'POST /api/v1/features/next to claim work (state becomes in_progress, started_at is stamped).',
      'PATCH status as you go so the human can follow along.',
      'PATCH pr_url once your pull request is open.',
      'When the PR merges on GitHub the feature completes on its own (completed_at is stamped).',
    ],
    endpoints: ENDPOINTS.map(([method, path, description]) => ({ method, path, description })),
  });
}
