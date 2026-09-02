import { existsSync, mkdirSync, openSync, closeSync, readFileSync, realpathSync } from 'node:fs';
import { spawn as nodeSpawn, execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detect } from './detect.mjs';
import { resolveWebServer } from './web-server.mjs';
import { resolveLocation } from './manifest.mjs';

const STATE_DIR = '.e2e-testing';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function defaultHttpProbe(url) {
  try {
    return Boolean(await fetch(url, { signal: AbortSignal.timeout(2000) }));
  } catch {
    return false;
  }
}

// Listening TCP ports owned by process group `pgid`. `-g <pgid>` selects by
// process-group id — the detached shell leads the group, so pgid is the child
// pid; `-iTCP -sTCP:LISTEN` narrows to listening sockets; `-F n` prints one
// name field per line (`n*:5174`, `n127.0.0.1:5174`, `n[::1]:5174`). lsof exits
// non-zero when it finds nothing (normal while the server starts) — treated as
// []. ENOENT (lsof absent) is rethrown for the caller to report as no-lsof.
function defaultListPorts(pgid) {
  let out;
  try {
    out = execFileSync('lsof', ['-nP', '-a', '-g', String(pgid), '-iTCP', '-sTCP:LISTEN', '-F', 'n'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (err) {
    if (err.code === 'ENOENT') throw err;
    return [];
  }
  const ports = [];
  for (const line of out.split('\n')) {
    const match = /^n.*:(\d+)$/.exec(line);
    if (match) ports.push(Number(match[1]));
  }
  return ports;
}

// Mirrors resolve-app-url.mjs's deps guards — duplicated rather than imported to
// keep the e2e-setup scripts self-contained (the same reason the generated
// config carries its own env-loader). A detected dev command needs the app's
// deps installed; without them the spawn dies as `spawn /bin/sh ENOENT`.
function depsInstalled(root, appDir, packageManager) {
  if (existsSync(join(appDir, 'node_modules'))) return true;
  for (const marker of ['.pnp.cjs', '.pnp.js', '.pnp.loader.mjs']) {
    if (existsSync(join(appDir, marker)) || existsSync(join(root, marker))) return true;
  }
  if (packageManager !== 'pnpm' && existsSync(join(root, 'node_modules'))) return true;
  return false;
}

function depsRequired(appDir) {
  try {
    const pkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'));
    return ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].some(
      (field) => pkg[field] && Object.keys(pkg[field]).length > 0,
    );
  } catch {
    return true;
  }
}

function tailLog(logPath, lines = 20) {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, 'utf8').split('\n').filter((line) => line.length > 0).slice(-lines);
}

// SIGTERM the whole group the detached shell leads, escalating to SIGKILL if it
// outlives the grace window. A negative pid targets the group; a platform
// without process groups rejects that, so fall back to the bare pid. Mirrors
// stopApp — no orphaned dev server on any exit path.
async function stopGroup(pgid, { kill, now, sleepMs, graceMs }) {
  const signal = (value) => {
    try {
      kill(-pgid, value);
      return true;
    } catch (err) {
      if (err.code === 'ESRCH') return false;
      kill(pgid, value);
      return true;
    }
  };
  if (!signal('SIGTERM')) return;
  const start = now();
  while (now() - start < graceMs) {
    await sleep(sleepMs);
    try {
      kill(-pgid, 0);
    } catch {
      return;
    }
  }
  signal('SIGKILL');
}

// Boot the resolved dev server, read the port its process group actually binds,
// and tear the group down. Report-only: the caller never writes this into .env,
// since a runtime port pinned once is wrong on the next run. Setup-time only —
// resolve-app-url.mjs stays inference-free (#157/#161).
export async function probeBoundPort(targetPath, options = {}) {
  const {
    location,
    spawn = nodeSpawn,
    listPorts = defaultListPorts,
    httpProbe = defaultHttpProbe,
    kill = process.kill.bind(process),
    now = () => Date.now(),
    timeoutMs = 30000,
    sleepMs = 500,
    graceMs = 2000,
  } = options;
  const root = resolve(targetPath);
  // The suite location (where the config/.env live), never the app --location:
  // server.cwd is relative to the suite's own config dir, so the base it is
  // resolved against here must always be the suite, whatever app --location
  // names.
  const webDir = resolveLocation(root, {});

  const server = resolveWebServer(detect(root), { location, suiteLocation: webDir });
  if (server.status !== 'resolved') return { ...server };

  // Something already serving the resolved port makes booting pointless and
  // unsafe to trust: Vite would auto-increment onto a free port, so the probe
  // would report a throwaway port the app never uses — and the responder may not
  // even be this app. Report the collision for a human to resolve rather than
  // assert an unverified port; never boot a duplicate into it.
  if (server.port && (await httpProbe(`http://localhost:${server.port}`))) {
    return { status: 'port-in-use', port: server.port, url: `http://localhost:${server.port}` };
  }

  const appDir = resolve(root, webDir, server.cwd);
  if (depsRequired(appDir) && !depsInstalled(root, appDir, server.packageManager)) {
    return { status: 'deps-missing', dir: appDir, packageManager: server.packageManager };
  }

  mkdirSync(join(root, STATE_DIR), { recursive: true });
  const logPath = join(root, STATE_DIR, 'probe.log');
  const logFd = openSync(logPath, 'w');
  let child;
  try {
    child = spawn('/bin/sh', ['-c', server.command], {
      cwd: appDir,
      detached: true,
      stdio: ['ignore', logFd, logFd],
    });
    child.unref();
  } finally {
    closeSync(logFd);
  }

  const pgid = child.pid;
  try {
    const start = now();
    while (now() - start < timeoutMs) {
      let ports;
      try {
        ports = listPorts(pgid);
      } catch (err) {
        if (err.code === 'ENOENT') return { status: 'no-lsof' };
        throw err;
      }
      for (const port of [...ports].sort((a, b) => a - b)) {
        if (await httpProbe(`http://localhost:${port}`)) {
          return { status: 'resolved', port, url: `http://localhost:${port}` };
        }
      }
      await sleep(sleepMs);
    }
    return { status: 'not-bound', logTail: tailLog(logPath) };
  } finally {
    await stopGroup(pgid, { kill, now, sleepMs, graceMs });
  }
}

const isMainModule = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const targetPath = process.argv[2] ?? '.';
  const index = process.argv.indexOf('--location');
  const location = index !== -1 ? process.argv[index + 1] : undefined;
  probeBoundPort(targetPath, { location })
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((err) => console.log(JSON.stringify({ status: 'error', message: err.message }, null, 2)));
}
