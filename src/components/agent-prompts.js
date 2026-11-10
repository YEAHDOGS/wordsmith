// Copy-paste prompts: the two in Settings → Connect an agent, and the per-project one in project settings. All are built
// from the API's own address, so a pasted prompt always points at the server this app talks to.
import { DIFFICULTY_LABELS, SMALL_DIFFICULTY } from '../lib/models.js';

const TOKEN_HEADER = 'Your wordsmith token is in the WORDSMITH_TOKEN environment variable. Send it as "Authorization: Bearer $WORDSMITH_TOKEN".';
const SMALL_LEVELS = DIFFICULTY_LABELS.slice(1, SMALL_DIFFICULTY + 1).map((label, index) => `${index + 1} ${label}`).join(', ');
const LARGE_LEVELS = DIFFICULTY_LABELS.slice(SMALL_DIFFICULTY + 1).map((label, index) => `${index + SMALL_DIFFICULTY + 1} ${label}`).join(', ');

/** Standing instructions for an agent's AGENTS.md / CLAUDE.md: the claim, report, PR loop. @param {(path: string) => string} url */
export function agentInstructions(url) {
  return `## wordsmith (feature queue)
${TOKEN_HEADER}
API: ${url('/api/v1')} (GET it for the full endpoint list)

Loop:
1. Before you start a feature, read its triage: GET ${url('/api/v1/notes/<id>/analysis')}. Earlier agents leave scope, files and plans there.
2. Claim work: POST ${url('/api/v1/features/next')} with JSON {"project":"<project name or id>"}. 204 means the queue is empty.
3. Report progress: PATCH ${url('/api/v1/notes/<id>')} with {"status":"short present-tense update"}. Do this at each milestone.
   Need a decision? PATCH {"ask":"question\\n1. option\\n2. option"}. It lands in the owner's Needs you view; the answer is appended to the body and ask clears.
4. When your pull request is open: PATCH the same URL with {"pr_url":"https://github.com/owner/repo/pull/123"}.
5. Record what you did: POST ${url('/api/v1/notes/<id>/analysis')} with {"analysis_append":"Done: ..."}.
6. Don't mark features complete yourself. Merging the PR completes them.
7. Have a new idea? POST ${url('/api/v1/features')} with {"project":"...","title":"...","body":"..."}.
8. Need a project that doesn't exist yet? POST ${url('/api/v1/projects')} with {"name":"...","repo":"owner/name"} (409 means it already exists; use that one).
Every call is timestamped on the feature's timeline under your token's name.`;
}

/** A scheduled run (T3 Code task, /schedule, cron): triage new features, ship the small ones in one daily PR. @param {(path: string) => string} url */
export function triagePrompt(url) {
  return `## wordsmith triage run
${TOKEN_HEADER}
API: ${url('/api/v1')}

1. See what earlier runs decided: GET ${url('/api/v1/batches')}. Today's batch is "small-fixes-YYYY-MM-DD" (today's date). If it already has an open pull request, keep working on that branch and PR. Otherwise branch from an up-to-date main branch.
2. Triage everything new: GET ${url('/api/v1/features?state=requested&analyzed=false')}. Read each feature and its attachments, then POST ${url('/api/v1/notes/<id>/analysis')} with {"difficulty":1-5,"batch":"...","analysis":"scope, files to touch, plan, risks"}.
   - Small (${SMALL_LEVELS}): batch "small-fixes-YYYY-MM-DD".
   - Large (${LARGE_LEVELS}): batch "discuss". Leave it requested and unclaimed for the owner to talk through.
3. Work the small ones in today's batch: POST ${url('/api/v1/notes/<id>/claim')}, make the change, verify it, commit, and PATCH ${url('/api/v1/notes/<id>')} {"status":"..."} as you go.
4. Push and open (or update) the one pull request for the batch. List every feature in its description. PATCH each feature with {"pr_url":"..."} and POST its analysis with {"analysis_append":"Done: what changed and how it was checked"}.
5. Something turned out bigger than it looked? Stop, append why to its analysis, raise its difficulty and move it to batch "discuss".
6. Never merge and never mark features complete. The owner reviews the batch PR; merging completes its features.`;
}

/** Work one project's queue, for the copy button in project settings. @param {{ id: string, name: string, repo: string }} project @param {(path: string) => string} url */
export function projectPrompt(project, url) {
  return `You have a wordsmith API token in $WORDSMITH_TOKEN. Work the "${project.name}" queue:
0. Read the project's mission statement first (its description in GET ${url('/api/v1/projects')}): what it is, why, and how to build it.
1. curl -s -X POST ${url('/api/v1/features/next')} -H "Authorization: Bearer $WORDSMITH_TOKEN" -H "Content-Type: application/json" -d '{"project":"${project.id}"}'
   (204 = nothing queued). This claims the feature for you.
2. As you work, PATCH ${url('/api/v1/notes/<id>')} with {"status":"what you're doing"}.
3. Open a PR${project.repo ? ` on ${project.repo}` : ''}, then PATCH {"pr_url":"https://github.com/..."}.
4. Repeat. Merged PRs complete features automatically. API docs: GET ${url('/api/v1')}`;
}