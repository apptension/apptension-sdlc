import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { listViewports } from './list-viewports.mjs';

// discover walks each path in the MCP browser at every viewport class the
// suite runs, and nothing a script can see records that the walk happened.
// So the agent writes a record of it, and this check compares the record
// against the classes list-viewports returns before any spec is written. A
// skipped class then stops the run or takes a false record, where it would
// otherwise leave no trace.
//
// It reads the write-specs payload itself, with the record beside the cases:
//   { "origin": "discover", "cases": [ { "flowId": "checkout", ... } ],
//     "viewportWalk": [ { "path": "checkout", "desktopOnly": false,
//                         "walks": [ { "class": "desktop", "result": "resolved" } ] } ] }
// So the paths checked are the flowIds about to be written, and a case the
// record leaves out fails at every class. write-specs ignores `viewportWalk`.
// `resolved` means the selectors resolved as written, `covered` that a
// narrow-layout locator was written for that class. `desktopOnly` is the
// human's choice to skip every non-desktop project, so such a path needs a
// desktop entry only.

const RESULTS = new Set(['resolved', 'covered']);

export function checkWalk(payload, classes) {
  const missing = [];
  const invalid = [];
  const done = () => ({ status: missing.length === 0 && invalid.length === 0 ? 'ok' : 'incomplete', missing, invalid });
  const byClass = new Map(classes.map((entry) => [entry.class, entry]));

  const cases = Array.isArray(payload?.cases) ? payload.cases : [];
  const flowIds = [...new Set(cases.map((entry) => entry?.flowId))];
  if (flowIds.length === 0) {
    invalid.push({ reason: 'the payload has no cases' });
    return done();
  }
  if (!Array.isArray(payload.viewportWalk)) {
    invalid.push({ reason: 'viewportWalk must be a list' });
    return done();
  }

  const recorded = new Set();
  for (const entry of payload.viewportWalk) {
    const path = typeof entry?.path === 'string' && entry.path.length > 0 ? entry.path : null;
    if (!path) {
      invalid.push({ reason: 'a viewportWalk entry has no path name' });
      continue;
    }
    recorded.add(path);
    if (!flowIds.includes(path)) {
      invalid.push({ path, reason: 'no case in the payload has this flowId' });
      continue;
    }
    if (!Array.isArray(entry.walks)) {
      invalid.push({ path, reason: 'walks must be a list' });
      continue;
    }

    const walked = new Set();
    for (const walk of entry.walks) {
      if (!byClass.has(walk?.class)) {
        invalid.push({ path, class: walk?.class, reason: 'the suite runs no project of this class' });
      } else if (!RESULTS.has(walk.result)) {
        invalid.push({ path, class: walk.class, reason: 'result must be resolved or covered' });
      } else {
        walked.add(walk.class);
      }
    }

    if (entry.desktopOnly === true && !byClass.has('desktop')) {
      invalid.push({ path, reason: 'desktop-only, but the suite runs no desktop project' });
      continue;
    }
    const required = entry.desktopOnly === true ? [byClass.get('desktop')] : classes;
    for (const cls of required) {
      if (!walked.has(cls.class)) missing.push({ path, ...cls });
    }
  }

  for (const path of flowIds) {
    if (!recorded.has(path)) missing.push(...classes.map((cls) => ({ path, ...cls })));
  }
  return done();
}

// `location` is the directory holding `@playwright/test`, as for
// list-viewports. The classes are read here rather than taken from the
// caller, so a payload is never checked against a shorter list than the suite
// runs.
export function checkViewportWalk(targetPath, payload, { location, run } = {}) {
  const viewports = listViewports(targetPath, { location, run });
  if (viewports.status !== 'ok') return viewports;
  if (viewports.classes.length === 0) {
    return { status: 'no-classes', location: viewports.location, unclassified: viewports.unclassified };
  }
  return { location: viewports.location, ...checkWalk(payload, viewports.classes) };
}

const isMainModule = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const args = process.argv.slice(2);
  const locationFlag = args.indexOf('--location');
  const location = locationFlag === -1 ? undefined : args[locationFlag + 1];
  const positional = args.filter((arg, index) => {
    if (locationFlag !== -1 && (index === locationFlag || index === locationFlag + 1)) return false;
    return !arg.startsWith('--');
  });
  const targetPath = positional[0] ?? '.';

  // An error envelope on stdout, exit 0, like the other discover entrypoints.
  const handleError = (err) => {
    console.log(JSON.stringify({ status: 'error', message: err.message }, null, 2));
    process.exitCode = 0;
  };

  const chunks = [];
  process.stdin.on('data', (chunk) => chunks.push(chunk));
  process.stdin.on('end', () => {
    try {
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      console.log(JSON.stringify(checkViewportWalk(targetPath, payload, { location }), null, 2));
    } catch (err) {
      handleError(err);
    }
  });
  process.stdin.on('error', handleError);
}
