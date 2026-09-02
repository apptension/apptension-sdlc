import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { listFlows } from '../../generate/scripts/list-flows.mjs';

// The same filename infix write-specs.mjs's smokeInfix() produces and
// e2e-setup's SMOKE_SPEC_PATTERN routes on — a flow directory with no file
// matching this has never had a merge-blocking whole-path test written for
// it, whatever granular specs it holds.
const SMOKE_SPEC_PATTERN = /\.smoke\.spec\.[a-z]+$/;

function hasSmokeSpec(specs) {
  return specs.some((spec) => SMOKE_SPEC_PATTERN.test(spec));
}

// Compares this run's candidate list against what actually sits under the
// spec dir, in both directions. Where step 3 today only ever filters
// candidates against existing flows and drops the rest silently, this names
// all three differences discover's idempotent-audit mode has to report:
// what the app has that the spec dir doesn't (untested), what the spec dir
// has that never got a whole-path test (noSmokeTest), and what the spec dir
// has that this run's scan no longer found in the app at all (unmatched).
//
// `unmatched` is never certainty that a path was removed — a code-only scan
// can miss a route a previous crawl found, or an issue-seeded run never
// looked at code at all. `scanSources` travels through unchanged so the
// caller can disclose exactly what this run looked at, next to the
// directories it's naming as unreached.
export function auditCoverage(targetPath, payload = {}, options = {}) {
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const scanSources = Array.isArray(payload.scanSources) ? payload.scanSources : [];

  const { specDir, flows } = listFlows(targetPath, options);
  const flowsById = new Map(flows.map((flow) => [flow.flowId, flow]));
  const candidatePaths = new Set(candidates.map((candidate) => candidate.path));

  const untested = candidates.filter((candidate) => !flowsById.has(candidate.path));
  const noSmokeTest = flows.filter((flow) => !hasSmokeSpec(flow.specs));
  const unmatched = flows.filter((flow) => !candidatePaths.has(flow.flowId));

  return { specDir, scanSources, untested, noSmokeTest, unmatched };
}

const isMainModule = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const targetPath = process.argv[2] ?? '.';
  const args = process.argv.slice(3);
  const specDirIndex = args.indexOf('--spec-dir');
  const specDir = specDirIndex !== -1 ? args[specDirIndex + 1] : undefined;

  const handleError = (err) => {
    console.log(JSON.stringify({ status: 'error', message: err.message }, null, 2));
    process.exitCode = 0;
  };

  const chunks = [];
  process.stdin.on('data', (chunk) => chunks.push(chunk));
  process.stdin.on('end', () => {
    try {
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      console.log(JSON.stringify(auditCoverage(targetPath, payload, { specDir }), null, 2));
    } catch (err) {
      handleError(err);
    }
  });
  process.stdin.on('error', handleError);
}
