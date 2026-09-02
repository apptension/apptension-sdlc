import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { spawn as nodeSpawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detect } from '../../e2e-setup/scripts/detect.mjs';
import { loadEnvFile, resolveWebServer } from '../../e2e-setup/scripts/web-server.mjs';
import { resolveLocation, rootRelativeCwd } from '../../e2e-setup/scripts/manifest.mjs';

const STATE_DIR = '.e2e-testing';

export function logFilePath(targetPath) {
  return join(targetPath, STATE_DIR, 'app.log');
}

export function pidFilePath(targetPath) {
  return join(targetPath, STATE_DIR, 'app.pid');
}

export function normalizeUrl(url) {
  const withHost = url.replace(/(https?:\/\/)(0\.0\.0\.0|\[::1\])/, '$1localhost');
  return new URL(withHost).toString();
}

export async function defaultProbe(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return Boolean(response);
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// E2E_BASE_URL is the only source of the app's URL — the generated config reads
// the same variable. This script infers nothing itself: e2e-setup resolves the
// port once, and writes it where a human can see and correct it, so an unset
// value here is a correctable stop rather than a guess that times out.
function readBaseUrl(root, env, webDir) {
  loadEnvFile(join(root, webDir), env);
  const raw = env.E2E_BASE_URL?.trim();
  return raw ? normalizeUrl(raw) : null;
}

// The environment is the steady-state source; detection is the fallback for a
// repo whose human hasn't exported the variables yet. `webDir` is the suite
// location — used only for the depth-aware default cwd, since a custom
// E2E_WEB_SERVER_CWD, once set, always wins.
function resolveCommand(root, env, location, webDir) {
  if (env.E2E_WEB_SERVER_COMMAND) {
    return {
      status: 'resolved',
      command: env.E2E_WEB_SERVER_COMMAND,
      cwd: env.E2E_WEB_SERVER_CWD || rootRelativeCwd(webDir),
      location: null,
    };
  }
  return resolveWebServer(detect(root), { location, suiteLocation: webDir });
}

function tailLog(logPath, lines = 20) {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, 'utf8').split('\n').filter((line) => line.length > 0).slice(-lines);
}

// Dependencies count as installed if any package manager's marker is present at
// the app dir or the repo root: a local `node_modules`, a root one they were
// hoisted into (workspaces), or Yarn Plug'n'Play's `.pnp.*`. Checking both dirs
// keeps the guard from rejecting a valid hoisted or PnP install that never
// writes `<appDir>/node_modules`.
function depsInstalled(root, appDir, packageManager) {
  // A local node_modules or a Yarn PnP loader at the app dir proves the app's
  // deps resolve, whatever the manager.
  if (existsSync(join(appDir, 'node_modules'))) return true;
  const pnpMarkers = ['.pnp.cjs', '.pnp.js', '.pnp.loader.mjs'];
  for (const marker of pnpMarkers) {
    if (existsSync(join(appDir, marker)) || existsSync(join(root, marker))) return true;
  }
  // A root node_modules only proves the selected package's deps for a manager
  // that hoists it flat into the root (npm, yarn, bun). pnpm's default isolated
  // linker keeps each package's deps in its own node_modules, so a root
  // node_modules there is root tooling, not the app's install.
  if (packageManager !== 'pnpm' && existsSync(join(root, 'node_modules'))) return true;
  return false;
}

// A package that declares no dependencies needs no install, so an absent
// node_modules there is not a problem — its start command runs on the runtime
// alone. Guarding it would reject a valid boot. On an unreadable package.json we
// can't tell, so keep the guard: a false stop with a clear message beats the
// misleading ENOENT the guard exists to prevent.
function depsRequired(appDir) {
  try {
    const pkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'));
    const fields = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
    return fields.some((field) => pkg[field] && Object.keys(pkg[field]).length > 0);
  } catch {
    return true;
  }
}

export async function resolveAppUrl(targetPath, options = {}) {
  const { location, probe = defaultProbe, env = process.env } = options;
  const root = resolve(targetPath);
  // The suite location, never the app --location: the suite's own .env lives
  // there regardless of which app directory --location tells the webServer
  // to boot.
  const webDir = resolveLocation(root, {});

  const url = readBaseUrl(root, env, webDir);
  if (!url) return { status: 'no-base-url' };
  if (await probe(url)) return { status: 'running', url };

  const server = resolveCommand(root, env, location, webDir);
  if (server.status !== 'resolved') return { ...server, url };
  return { status: 'not-running', url, command: server.command, cwd: server.cwd, location: server.location };
}

export async function startApp(targetPath, options = {}) {
  const {
    location,
    probe = defaultProbe,
    env = process.env,
    spawn = nodeSpawn,
    kill,
    timeoutMs = 90000,
    sleepMs = 500,
    now = () => Date.now(),
  } = options;
  const root = resolve(targetPath);
  const webDir = resolveLocation(root, {});

  const url = readBaseUrl(root, env, webDir);
  if (!url) return { status: 'no-base-url' };
  // Never double-boot: an app the human started is theirs, and writing no
  // pidfile here is what makes stopApp structurally unable to kill it.
  if (await probe(url)) return { status: 'running', url };

  const server = resolveCommand(root, env, location, webDir);
  if (server.status !== 'resolved') return { ...server, url };

  // A detected dev command needs the app's dependencies installed; without them
  // the spawn dies as `spawn /bin/sh ENOENT`, naming the shell, not the cause.
  // A custom E2E_WEB_SERVER_COMMAND carries no packageManager and is the human's
  // to provision, so this guard covers only the detected path.
  if (server.packageManager) {
    const appDir = resolve(root, webDir, server.cwd);
    if (depsRequired(appDir) && !depsInstalled(root, appDir, server.packageManager)) {
      return { status: 'deps-missing', url, dir: appDir, packageManager: server.packageManager };
    }
  }

  mkdirSync(join(root, STATE_DIR), { recursive: true });
  const logPath = logFilePath(root);
  // 'w', not 'a': a fresh log per boot, so a timeout's tail is this boot's
  // output and never a previous run's.
  const logFd = openSync(logPath, 'w');
  let child;
  try {
    child = spawn('/bin/sh', ['-c', server.command], {
      cwd: resolve(root, webDir, server.cwd),
      // A new process group: the shell leads it, so every descendant the start
      // command forks (a package-manager wrapper's real server) is reachable by
      // signalling the group instead of just the wrapper pid.
      detached: true,
      stdio: ['ignore', logFd, logFd],
    });
    child.unref();
  } finally {
    closeSync(logFd);
  }

  writeFileSync(
    pidFilePath(root),
    `${JSON.stringify({ pid: child.pid, url, command: server.command }, null, 2)}\n`,
  );

  const start = now();
  while (now() - start < timeoutMs) {
    if (await probe(url)) return { status: 'booted', url, pid: child.pid, logPath };
    await sleep(sleepMs);
  }

  // A boot that never came up must not leak the process it started.
  await stopApp(root, { kill, sleepMs });
  return { status: 'timeout', url, pid: child.pid, logTail: tailLog(logPath) };
}

export async function stopApp(targetPath, options = {}) {
  const {
    kill = process.kill.bind(process),
    sleepMs = 100,
    graceMs = 2000,
    now = () => Date.now(),
  } = options;
  const root = resolve(targetPath);
  const pidPath = pidFilePath(root);

  // No pidfile means this run never started anything — a no-op, not an error, so
  // the teardown step can be called unconditionally on every exit path.
  if (!existsSync(pidPath)) return { status: 'not-running' };

  let pid = null;
  try {
    pid = JSON.parse(readFileSync(pidPath, 'utf8')).pid;
  } catch {
    pid = null;
  }
  if (!Number.isInteger(pid)) {
    rmSync(pidPath, { force: true });
    return { status: 'not-running' };
  }

  // Negative pid targets the whole group the detached shell leads. A platform
  // without process groups rejects that, so fall back to the bare pid.
  const signal = (value) => {
    try {
      kill(-pid, value);
      return true;
    } catch (err) {
      if (err.code === 'ESRCH') return false;
      kill(pid, value);
      return true;
    }
  };

  if (!signal('SIGTERM')) {
    rmSync(pidPath, { force: true });
    return { status: 'already-stopped', pid };
  }

  const start = now();
  while (now() - start < graceMs) {
    await sleep(sleepMs);
    try {
      kill(-pid, 0);
    } catch {
      rmSync(pidPath, { force: true });
      return { status: 'stopped', pid };
    }
  }

  signal('SIGKILL');
  rmSync(pidPath, { force: true });
  return { status: 'stopped', pid, escalated: true };
}

const isMainModule = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const targetPath = process.argv[2] ?? '.';
  const args = process.argv.slice(3);
  const flag = (name) => {
    const index = args.indexOf(name);
    return index !== -1 ? args[index + 1] : undefined;
  };

  const print = (result) => console.log(JSON.stringify(result, null, 2));
  const handleError = (err) => {
    console.log(JSON.stringify({ status: 'error', message: err.message }, null, 2));
    process.exitCode = 0;
  };

  // A non-numeric --timeout used to become Number('foo') === NaN, so the boot
  // loop's `now() - start < NaN` was never true and the app died as a false
  // timeout. Reject it up front — the same finite check resolveTimeoutMs uses —
  // as a bad-argument error the human must fix, before dispatching anything.
  // Presence is tracked separately from the value: a trailing `--timeout` with
  // no argument is a malformed invocation, not an absent flag, so it must error
  // rather than fall through to the default.
  const timeoutProvided = args.includes('--timeout');
  const timeout = flag('--timeout');
  const timeoutMs = timeout === undefined ? undefined : Number(timeout);
  if (timeoutProvided && !(Number.isFinite(timeoutMs) && timeoutMs > 0)) {
    print({ status: 'error', message: `--timeout must be a positive number of milliseconds, got "${timeout ?? ''}"` });
    process.exitCode = 1;
  } else {
    const shared = { location: flag('--location'), timeoutMs };

    // deps-missing is the one start outcome the human must act on before a rerun
    // can work, so it exits non-zero — unlike the other reported stops.
    const printStart = (result) => {
      print(result);
      if (result.status === 'deps-missing') process.exitCode = 1;
    };

    if (args.includes('--stop')) stopApp(targetPath).then(print).catch(handleError);
    else if (args.includes('--start')) startApp(targetPath, shared).then(printStart).catch(handleError);
    else resolveAppUrl(targetPath, { location: shared.location }).then(print).catch(handleError);
  }
}
