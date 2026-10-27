// GET /api/projects/:id/pulls - the linked repo's open and recently merged pull requests, straight from GitHub.
import { repoPulls } from '../../../../lib/github-api.js';
import { githubContext } from '../../../../lib/github-route.js';
import { HttpError, json } from '../../../../lib/http.js';
import { isId } from '../../../../../src/lib/models.js';

/** @param {{ request: Request, env: Record<string, any>, params: { id: string } }} context */
export async function onRequestGet(context) {
  const { auth, token } = await githubContext(context);
  if (!isId(context.params.id)) throw new HttpError(400, 'Bad project id');
  const project = await context.env.DB.prepare('SELECT repo FROM projects WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
    .bind(context.params.id, auth.user.id).first();
  if (!project) throw new HttpError(404, 'Project not found. Sync it first.');
  if (!project.repo) throw new HttpError(400, 'Link a GitHub repo to this project first');
  return json({ ...(await repoPulls(token, auth.user.id, String(project.repo))), authenticated: Boolean(token) });
}
