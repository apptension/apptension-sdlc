'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function pickPullRequestRun(runs) {
  return (runs || []).find((run) => run.event === 'pull_request' || run.event === 'pull_request_target') || null;
}

function failedJobsFrom(jobs) {
  const failed = [];
  for (const job of jobs || []) {
    if (job?.conclusion !== 'failure' && job?.conclusion !== 'timed_out') continue;
    failed.push({ name: job.name || 'unknown', conclusion: job.conclusion });
  }
  return failed;
}

function pendingResult(url) {
  return {
    status: 'pending',
    conclusion: null,
    url: url || null,
    failedJobs: [],
    failedLog: '',
  };
}

function resolveCiResults(runs, details = {}) {
  const run = pickPullRequestRun(runs);
  if (!run || run.status !== 'completed') return pendingResult(run && run.url);
  return {
    status: 'completed',
    conclusion: run.conclusion || null,
    url: run.url || null,
    failedJobs: failedJobsFrom(details.jobs),
    failedLog: details.failedLog || '',
  };
}

function renderCiResults(result) {
  const lines = [
    '# CI workflow test results',
    '',
    `status: ${result.status}`,
    `conclusion: ${result.conclusion || ''}`,
    `url: ${result.url || ''}`,
  ];
  if (result.status === 'pending') {
    lines.push(
      '',
      'The CI run has not finished. Do not run the test suite; read this file instead.',
    );
    return `${lines.join('\n')}\n`;
  }
  if (result.failedJobs.length) {
    lines.push('', '## Failed jobs', '');
    for (const job of result.failedJobs) {
      lines.push(`### ${job.name}`, '', `conclusion: ${job.conclusion}`, '');
    }
  }
  if (result.failedLog) {
    lines.push('## Failed step log', '', '```', result.failedLog.replace(/```/g, "'''").trimEnd(), '```', '');
  }
  return `${lines.join('\n')}\n`;
}

function collectCiResults({ gh, repo, headSha }) {
  const runs = listCiRuns(gh, repo, headSha);
  const run = pickPullRequestRun(runs);
  if (!run || run.status !== 'completed') return resolveCiResults(runs);

  let jobs = [];
  let failedLog = '';
  try {
    jobs = JSON.parse(gh(['run', 'view', String(run.databaseId), '--repo', repo, '--json', 'jobs'])).jobs || [];
  } catch {
    jobs = [];
  }
  if (run.conclusion === 'failure' || run.conclusion === 'timed_out') {
    try {
      failedLog = gh(['run', 'view', String(run.databaseId), '--repo', repo, '--log-failed']);
    } catch {
      failedLog = '';
    }
  }
  return resolveCiResults(runs, { jobs, failedLog });
}

function writeCiResults({ out, result }) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, renderCiResults(result), 'utf8');
}

const DEFAULT_WAIT_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_WAIT_POLL_MS = 15_000;

function listCiRuns(gh, repo, headSha) {
  return JSON.parse(
    gh([
      'run',
      'list',
      '--repo',
      repo,
      '--workflow',
      '%%CI_WORKFLOW_FILE%%',
      '--commit',
      headSha,
      '--limit',
      '20',
      '--json',
      'databaseId,status,conclusion,url,event,headSha',
    ]),
  );
}

function defaultSleep(ms) {
  execFileSync('sleep', [String(ms / 1000)]);
}

function waitForCiRun({
  gh,
  repo,
  headSha,
  now = Date.now,
  sleep = defaultSleep,
  timeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_WAIT_POLL_MS,
}) {
  const deadline = now() + timeoutMs;
  while (true) {
    const run = pickPullRequestRun(listCiRuns(gh, repo, headSha));
    if (run) {
      if (run.status !== 'completed') {
        gh(['run', 'watch', String(run.databaseId), '--repo', repo]);
      }
      return run;
    }
    if (now() >= deadline) {
      throw new Error(`Timed out waiting for %%CI_WORKFLOW_FILE%% pull_request run for ${headSha}`);
    }
    sleep(Math.min(pollIntervalMs, Math.max(0, deadline - now())));
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--wait') {
      parsed.wait = true;
      continue;
    }
    const value = argv[i + 1];
    if (key === '--repo') parsed.repo = value;
    else if (key === '--head-sha') parsed.headSha = value;
    else if (key === '--out') parsed.out = value;
    else continue;
    i += 1;
  }
  if (!parsed.repo || !parsed.headSha || (!parsed.wait && !parsed.out)) {
    throw new Error('Usage: %%FETCH_SCRIPT%%.%%EXT%% --repo owner/name --head-sha SHA (--out path | --wait)');
  }
  return parsed;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const gh = (argv) => execFileSync('gh', argv, { encoding: 'utf8' });
  if (args.wait) {
    waitForCiRun({ gh, repo: args.repo, headSha: args.headSha });
  } else {
    writeCiResults({
      out: args.out,
      result: collectCiResults({ gh, repo: args.repo, headSha: args.headSha }),
    });
  }
}

module.exports = {
  parseArgs,
  resolveCiResults,
  renderCiResults,
  collectCiResults,
  writeCiResults,
  waitForCiRun,
};
