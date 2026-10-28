// The sidebar's order of pages, shared by the Sidebar (which draws it) and the Shell's page carousel (which slides
// between them in that order): All notes, Features, projects A-Z, labels A-Z, then the Archive in the footer.

const TOP_VIEWS = ['notes', 'features'];
const BOTTOM_VIEWS = ['archive'];

/** Live rows sorted by name, the way the sidebar lists them. @param {any[]} rows */
export function byName(rows) {
  return rows.filter((row) => !row.deleted_at).sort((a, b) => a.name.localeCompare(b.name));
}

/** Every page key in sidebar order (`notes`, `project/<id>`, ...). @param {{ projects: any[], labels: any[] }} store */
export function navOrder({ projects, labels }) {
  return [
    ...TOP_VIEWS,
    ...byName(projects).map((project) => `project/${project.id}`),
    ...byName(labels).map((label) => `label/${label.id}`),
    ...BOTTOM_VIEWS,
  ];
}
