// GET /api/v1/projects - projects with feature counts per state. POST - create one: { name, description?, color?, repo? }.
import { createProject } from '../../../lib/agent.js';
import { json, readJson } from '../../../lib/http.js';
import { toApi } from '../../../lib/rows.js';

/** @param {{ env: Record<string, any>, data: Record<string, any> }} context */
export async function onRequestGet({ env, data }) {
  const userId = data.auth.user.id;
  const [projects, counts] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM projects WHERE user_id = ? AND deleted_at IS NULL ORDER BY name').bind(userId),
    env.DB.prepare("SELECT project_id, state, COUNT(*) AS n FROM notes WHERE user_id = ? AND kind = 'feature' AND deleted_at IS NULL AND archived = 0 GROUP BY project_id, state").bind(userId),
  ]);
  return json({
    projects: projects.results.map((/** @type {any} */ row) => {
      const features = { requested: 0, in_progress: 0, complete: 0 };
      for (const count of counts.results) if (count.project_id === row.id) features[/** @type {keyof typeof features} */ (count.state)] = count.n;
      return { ...toApi(row), features };
    }),
  });
}

/** @param {{ request: Request, env: Record<string, any>, data: Record<string, any> }} context */
export async function onRequestPost({ request, env, data }) {
  return json({ project: await createProject(env, data.auth.user.id, await readJson(request)) }, 201);
}
