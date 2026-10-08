const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  parseArgs,
  resolveCiResults,
  renderCiResults,
  collectCiResults,
  writeCiResults,
  waitForCiRun,
} = require('./%%FETCH_SCRIPT%%.%%EXT%%');

test('resolveCiResults records a missing or unfinished run as pending', () => {
  assert.deepEqual(resolveCiResults([]), {
    status: 'pending',
    conclusion: null,
    url: null,
    failedJobs: [],
    failedLog: '',
  });
  assert.equal(
    resolveCiResults([
      {
        databaseId: 1,
        status: 'in_progress',
        conclusion: '',
        url: 'https://example.test/1',
        event: 'pull_request',
      },
    ]).status,
    'pending',
  );
  assert.equal(
    resolveCiResults([
      {
        databaseId: 1,
        status: 'completed',
        conclusion: 'success',
        url: 'https://example.test/push',
        event: 'push',
      },
    ]).status,
    'pending',
  );
});

test('resolveCiResults accepts a pull_request_target run — some verification suites trigger on it', () => {
  const result = resolveCiResults([
    {
      databaseId: 2,
      status: 'completed',
      conclusion: 'success',
      url: 'https://example.test/2',
      event: 'pull_request_target',
    },
  ]);
  assert.equal(result.status, 'completed');
  assert.equal(result.conclusion, 'success');
});

test('resolveCiResults keeps a completed success without treating it as pending', () => {
  const result = resolveCiResults(
    [
      {
        databaseId: 9,
        status: 'completed',
        conclusion: 'success',
        url: 'https://example.test/9',
        event: 'pull_request',
      },
    ],
    {
      jobs: [
        {
          name: 'Unit, build, E2E, and package',
          conclusion: 'success',
        },
      ],
    },
  );

  assert.equal(result.status, 'completed');
  assert.equal(result.conclusion, 'success');
  assert.equal(result.url, 'https://example.test/9');
  assert.deepEqual(result.failedJobs, []);
});

test('resolveCiResults includes failing job names and log output', () => {
  const failedLog = 'npm test failed\nAssertionError: expected 1 to equal 2\n';
  const result = resolveCiResults(
    [
      {
        databaseId: 7,
        status: 'completed',
        conclusion: 'failure',
        url: 'https://example.test/7',
        event: 'pull_request',
      },
    ],
    {
      jobs: [
        {
          name: 'Unit, build, E2E, and package',
          conclusion: 'failure',
        },
      ],
      failedLog,
    },
  );

  assert.equal(result.status, 'completed');
  assert.equal(result.conclusion, 'failure');
  assert.deepEqual(result.failedJobs, [
    { name: 'Unit, build, E2E, and package', conclusion: 'failure' },
  ]);
  assert.match(result.failedLog, /AssertionError/);
});

test('renderCiResults names pending so a reviewer does not wait on a crash', () => {
  const text = renderCiResults({
    status: 'pending',
    conclusion: null,
    url: null,
    failedJobs: [],
    failedLog: '',
  });

  assert.match(text, /^# CI workflow test results$/m);
  assert.match(text, /^status: pending$/m);
  assert.match(text, /has not finished/i);
  assert.doesNotMatch(text, /^## Failed jobs/m);
});

test('renderCiResults lists failing jobs for a completed failure', () => {
  const text = renderCiResults({
    status: 'completed',
    conclusion: 'failure',
    url: 'https://example.test/7',
    failedJobs: [{ name: 'Unit, build, E2E, and package', conclusion: 'failure' }],
    failedLog: 'AssertionError: expected 1 to equal 2\n',
  });

  assert.match(text, /^status: completed$/m);
  assert.match(text, /^conclusion: failure$/m);
  assert.match(text, /^url: https:\/\/example\.test\/7$/m);
  assert.match(text, /Unit, build, E2E, and package/);
  assert.match(text, /AssertionError/);
});

test('collectCiResults treats a missing workflow run as pending, not an error', () => {
  const calls = [];
  const gh = (args) => {
    calls.push(args);
    if (args[0] === 'run' && args[1] === 'list') return '[]';
    throw new Error(`unexpected gh ${args.join(' ')}`);
  };

  const result = collectCiResults({ gh, repo: 'owner/repo', headSha: 'abc' });

  assert.equal(result.status, 'pending');
  assert.ok(calls[0].includes('%%CI_WORKFLOW_FILE%%'));
  assert.ok(calls[0].includes('abc'));
});

test('collectCiResults pulls failing job names from the failed-step log', () => {
  const gh = (args) => {
    if (args[0] === 'run' && args[1] === 'list') {
      return JSON.stringify([
        {
          databaseId: 7,
          status: 'completed',
          conclusion: 'failure',
          url: 'https://example.test/7',
          event: 'pull_request',
        },
      ]);
    }
    if (args.includes('--json') && args.includes('jobs')) {
      return JSON.stringify({
        jobs: [
          {
            name: 'Unit, build, E2E, and package',
            conclusion: 'failure',
          },
        ],
      });
    }
    if (args.includes('--log-failed')) {
      return 'AssertionError: expected 1 to equal 2\n';
    }
    throw new Error(`unexpected gh ${args.join(' ')}`);
  };

  const result = collectCiResults({ gh, repo: 'owner/repo', headSha: 'abc' });

  assert.equal(result.status, 'completed');
  assert.equal(result.conclusion, 'failure');
  assert.deepEqual(result.failedJobs, [
    { name: 'Unit, build, E2E, and package', conclusion: 'failure' },
  ]);
});

test('writeCiResults writes the file and does not throw when CI is pending', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-results-'));
  const out = path.join(dir, 'ci-results.md');
  writeCiResults({
    out,
    result: {
      status: 'pending',
      conclusion: null,
      url: null,
      failedJobs: [],
      failedLog: '',
    },
  });
  const text = fs.readFileSync(out, 'utf8');
  assert.match(text, /^status: pending$/m);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('waitForCiRun polls until a pull_request run exists, then watches it', () => {
  const calls = [];
  let lists = 0;
  const gh = (args) => {
    calls.push(args);
    if (args[0] === 'run' && args[1] === 'list') {
      lists += 1;
      if (lists < 3) return '[]';
      return JSON.stringify([
        {
          databaseId: 42,
          status: 'in_progress',
          conclusion: '',
          url: 'https://example.test/42',
          event: 'pull_request',
          headSha: 'abc',
        },
      ]);
    }
    if (args[0] === 'run' && args[1] === 'watch') return '';
    throw new Error(`unexpected gh ${args.join(' ')}`);
  };

  const run = waitForCiRun({
    gh,
    repo: 'owner/repo',
    headSha: 'abc',
    now: () => 0,
    sleep: () => {},
    timeoutMs: 60_000,
    pollIntervalMs: 1,
  });

  assert.equal(run.databaseId, 42);
  assert.equal(lists, 3);
  assert.ok(calls.some((args) => args[1] === 'watch' && args.includes('42')));
  assert.ok(!calls.some((args) => args.includes('--exit-status')));
});

test('waitForCiRun lists %%CI_WORKFLOW_FILE%% for the given head SHA, not a previous commit', () => {
  const calls = [];
  const gh = (args) => {
    calls.push(args);
    if (args[0] === 'run' && args[1] === 'list') {
      return JSON.stringify([
        {
          databaseId: 99,
          status: 'completed',
          conclusion: 'success',
          url: 'https://example.test/99',
          event: 'pull_request',
          headSha: 'newsha',
        },
      ]);
    }
    throw new Error(`unexpected gh ${args.join(' ')}`);
  };

  waitForCiRun({
    gh,
    repo: 'owner/repo',
    headSha: 'newsha',
    now: () => 0,
    sleep: () => {},
    timeoutMs: 60_000,
    pollIntervalMs: 1,
  });

  const list = calls.find((args) => args[1] === 'list');
  assert.ok(list.includes('%%CI_WORKFLOW_FILE%%'));
  assert.ok(list.includes('--commit'));
  assert.equal(list[list.indexOf('--commit') + 1], 'newsha');
  assert.ok(!list.includes('oldsha'));
});

test('waitForCiRun ignores a push run and waits for the pull_request run', () => {
  let lists = 0;
  const gh = (args) => {
    if (args[0] === 'run' && args[1] === 'list') {
      lists += 1;
      if (lists === 1) {
        return JSON.stringify([
          {
            databaseId: 1,
            status: 'completed',
            conclusion: 'success',
            url: 'https://example.test/push',
            event: 'push',
            headSha: 'abc',
          },
        ]);
      }
      return JSON.stringify([
        {
          databaseId: 2,
          status: 'completed',
          conclusion: 'success',
          url: 'https://example.test/pr',
          event: 'pull_request',
          headSha: 'abc',
        },
      ]);
    }
    throw new Error(`unexpected gh ${args.join(' ')}`);
  };

  const run = waitForCiRun({
    gh,
    repo: 'owner/repo',
    headSha: 'abc',
    now: () => 0,
    sleep: () => {},
    timeoutMs: 60_000,
    pollIntervalMs: 1,
  });

  assert.equal(run.databaseId, 2);
  assert.equal(run.event, 'pull_request');
});

test('waitForCiRun times out instead of returning pending', () => {
  let t = 0;
  const gh = (args) => {
    if (args[0] === 'run' && args[1] === 'list') return '[]';
    throw new Error(`unexpected gh ${args.join(' ')}`);
  };

  assert.throws(
    () =>
      waitForCiRun({
        gh,
        repo: 'owner/repo',
        headSha: 'abc',
        now: () => t,
        sleep: (ms) => {
          t += ms;
        },
        timeoutMs: 30_000,
        pollIntervalMs: 10_000,
      }),
    /timed out/i,
  );
});

test('waitForCiRun returns a completed failure so Codex can still start', () => {
  const calls = [];
  const gh = (args) => {
    calls.push(args);
    if (args[0] === 'run' && args[1] === 'list') {
      return JSON.stringify([
        {
          databaseId: 7,
          status: 'completed',
          conclusion: 'failure',
          url: 'https://example.test/7',
          event: 'pull_request',
          headSha: 'abc',
        },
      ]);
    }
    throw new Error(`unexpected gh ${args.join(' ')}`);
  };

  const run = waitForCiRun({
    gh,
    repo: 'owner/repo',
    headSha: 'abc',
    now: () => 0,
    sleep: () => {},
    timeoutMs: 60_000,
    pollIntervalMs: 1,
  });

  assert.equal(run.status, 'completed');
  assert.equal(run.conclusion, 'failure');
  assert.ok(!calls.some((args) => args[1] === 'watch'));
});

test('parseArgs accepts --wait without --out and still requires --out otherwise', () => {
  assert.deepEqual(parseArgs(['--repo', 'o/n', '--head-sha', 'abc', '--wait']), {
    repo: 'o/n',
    headSha: 'abc',
    wait: true,
  });
  assert.throws(
    () => parseArgs(['--repo', 'o/n', '--head-sha', 'abc']),
    /Usage: %%FETCH_SCRIPT%%\.%%EXT%%/,
  );
});
