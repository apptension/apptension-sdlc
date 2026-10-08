import { writeFileSync } from 'node:fs';

// A Playwright reporter list-viewports.mjs passes to `playwright test --list`.
// By `onBegin` Playwright has resolved every project: the config-level `use`,
// device spreads, variables and shorthand are all merged. So the size read
// here is the one each project runs at, not a guess from the config's source.
// It writes one entry per project to the file E2E_VIEWPORTS_OUT names.
export default class ViewportsReporter {
  onBegin(config) {
    const projects = config.projects.map((project, index) => ({
      // A name is optional in Playwright; an unnamed project is labelled by
      // its place in the array.
      name: project.name || `project ${index + 1}`,
      // Which projects run first or last, so list-viewports can prefer a spec
      // project's size over a setup or teardown project's.
      dependencies: project.dependencies ?? [],
      ...(project.teardown ? { teardown: project.teardown } : {}),
      // `undefined` is Playwright's default size and `null` is emulation off.
      // JSON keeps the difference: an absent key and a null value.
      ...(project.use?.viewport !== undefined ? { viewport: project.use.viewport } : {}),
      isMobile: Boolean(project.use?.isMobile),
    }));
    writeFileSync(process.env.E2E_VIEWPORTS_OUT, JSON.stringify(projects));
  }

  printsToStdio() {
    return false;
  }
}
