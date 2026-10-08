import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detect } from '../../e2e-setup/scripts/detect.mjs';
import { WEB_DIR } from '../../e2e-setup/scripts/manifest.mjs';
import { defaultRun, listCommand, resolveLocation } from '../../generate/scripts/run-specs.mjs';

// discover verifies selectors in the MCP browser, and the suite then runs
// every project. A sidebar a phone collapses fails there and nowhere earlier,
// so discover needs one viewport per class the projects cover — desktop,
// tablet, phone — to resize to before it writes a spec.
//
// The sizes come from Playwright itself: `playwright test --list` with the
// reporter beside this file, which reads each project after Playwright has
// merged its settings. Reading the config's source instead misses every shape
// a regex does not expect.

export const REPORTER_PATH = fileURLToPath(new URL('./viewports-reporter.mjs', import.meta.url));

const CLASS_ORDER = ['desktop', 'tablet', 'phone'];

// A mobile project is a tablet when its shorter side is at least this wide. A
// project not marked mobile is classed by its width, since the layout follows
// the width: under TABLET_MIN_SIDE is a phone, under DESKTOP_MIN_WIDTH a tablet.
const TABLET_MIN_SIDE = 600;
const DESKTOP_MIN_WIDTH = 1024;

// Playwright's own size when nothing sets a viewport.
const DEFAULT_VIEWPORT = { width: 1280, height: 720 };

function head(text, lines = 20) {
  return text.split('\n').filter((line) => line.length > 0).slice(0, lines);
}

function classify({ width, height }, isMobile) {
  if (isMobile) return Math.min(width, height) >= TABLET_MIN_SIDE ? 'tablet' : 'phone';
  if (width >= DESKTOP_MIN_WIDTH) return 'desktop';
  return width >= TABLET_MIN_SIDE ? 'tablet' : 'phone';
}

// `projects` is the reporter's output. A project another one names in
// `dependencies` or `teardown` usually runs setup, as the scaffold's `setup`
// does, so each class takes its size from a spec project first. A dependency
// project can still match and run specs, so one fills a class nothing else
// covers rather than leave that layout unchecked. A project with
// `viewport: null` has emulation off, so the window decides its size and
// there is none to resize to; it is named in `unclassified`, never guessed at.
export function classifyProjects(projects) {
  const runsFirstOrLast = new Set(
    projects.flatMap((project) => [...(project.dependencies ?? []), ...(project.teardown ? [project.teardown] : [])]),
  );
  const ordered = [
    ...projects.filter((project) => !runsFirstOrLast.has(project.name)),
    ...projects.filter((project) => runsFirstOrLast.has(project.name)),
  ];
  const byClass = new Map();
  const unclassified = [];
  for (const project of ordered) {
    if (project.viewport === null) {
      unclassified.push(project.name);
      continue;
    }
    const viewport = project.viewport ?? DEFAULT_VIEWPORT;
    const cls = classify(viewport, project.isMobile);
    if (!byClass.has(cls)) byClass.set(cls, { class: cls, project: project.name, ...viewport });
  }
  const classes = CLASS_ORDER.filter((cls) => byClass.has(cls)).map((cls) => byClass.get(cls));
  return { classes, unclassified };
}

// `location` is the directory holding `@playwright/test`, the suite directory
// from the `### E2E bindings` Location row after normal setup. Without it the
// suite is the default e2e/web when that carries Playwright, else the single
// location that does. Several with none at e2e/web is `ambiguous`: each is a
// different suite, and another suite's projects are the wrong sizes.
function suiteLocation(detected, location) {
  if (location) return resolveLocation(detected, [], location);
  const withPlaywright = detected.locations.filter((entry) => entry.playwright?.installed).map((entry) => entry.path);
  if (withPlaywright.includes(WEB_DIR)) return { status: 'resolved', location: WEB_DIR };
  if (withPlaywright.length === 0) return { status: 'no-playwright' };
  if (withPlaywright.length === 1) return { status: 'resolved', location: withPlaywright[0] };
  return { status: 'ambiguous', candidates: withPlaywright };
}

export function listViewports(targetPath, { location, run = defaultRun } = {}) {
  const detected = detect(targetPath, { location });
  const resolved = suiteLocation(detected, location);
  if (resolved.status !== 'resolved') return resolved;

  const cwd = resolved.location === '.' ? targetPath : join(targetPath, resolved.location);
  const dir = mkdtempSync(join(tmpdir(), 'e2e-viewports-'));
  const out = join(dir, 'projects.json');
  try {
    const [command, args] = listCommand(detected.packageManager, []);
    const { stderr } = run(command, [...args, '--reporter', REPORTER_PATH], {
      cwd,
      env: { ...process.env, E2E_VIEWPORTS_OUT: out },
    });
    // A config that fails to load never reaches the reporter. The error
    // message leads Playwright's output and the stack follows, so keep the head.
    if (!existsSync(out)) return { status: 'error', location: resolved.location, stderr: head(stderr ?? '') };
    const projects = JSON.parse(readFileSync(out, 'utf8'));
    return { status: 'ok', location: resolved.location, ...classifyProjects(projects) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const isMainModule = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    const args = process.argv.slice(2);
    const locationFlag = args.indexOf('--location');
    const location = locationFlag === -1 ? undefined : args[locationFlag + 1];
    const positional = args.filter((arg, index) => {
      if (locationFlag !== -1 && (index === locationFlag || index === locationFlag + 1)) return false;
      return !arg.startsWith('--');
    });
    const targetPath = positional[0] ?? '.';
    console.log(JSON.stringify(listViewports(targetPath, { location }), null, 2));
  } catch (err) {
    // An error envelope on stdout, exit 0, like the other discover entrypoints.
    console.log(JSON.stringify({ status: 'error', message: err.message }, null, 2));
    process.exitCode = 0;
  }
}
