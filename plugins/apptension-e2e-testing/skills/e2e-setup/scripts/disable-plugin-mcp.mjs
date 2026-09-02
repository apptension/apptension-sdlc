import { existsSync, readFileSync, writeFileSync, renameSync, realpathSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

export const SCOPED_NAME = 'plugin:apptension-e2e-testing:playwright';

export function disablePluginMcp(targetPath, homeDir = homedir()) {
  // Claude Code keys ~/.claude.json's `projects` map by the absolute cwd
  // path, so resolve once here rather than trusting the caller's (possibly
  // relative) targetPath.
  const root = resolve(targetPath);
  const path = join(homeDir, '.claude.json');
  const fileExists = existsSync(path);
  const config = fileExists ? JSON.parse(readFileSync(path, 'utf8')) : {};
  config.projects ??= {};
  config.projects[root] ??= {};
  const project = config.projects[root];
  project.disabledMcpServers ??= [];
  if (project.disabledMcpServers.includes(SCOPED_NAME)) return { status: 'already' };
  project.disabledMcpServers.push(SCOPED_NAME);
  // Write atomically: this is the user's global config, potentially
  // multi-MB, and a crash mid-write must not truncate it. The temp file is
  // created with the default umask, which would silently widen an existing
  // 0600 file (this config can hold MCP env credentials) — so carry the
  // original mode forward, or lock a brand-new file down to 0600.
  const mode = fileExists ? statSync(path).mode & 0o777 : 0o600;
  const tmpPath = `${path}.tmp-${process.pid}`;
  writeFileSync(tmpPath, `${JSON.stringify(config, null, 2)}\n`, { mode });
  renameSync(tmpPath, path);
  return { status: 'disabled' };
}

export function enablePluginMcp(targetPath, homeDir = homedir()) {
  const root = resolve(targetPath);
  const path = join(homeDir, '.claude.json');
  const fileExists = existsSync(path);
  const config = fileExists ? JSON.parse(readFileSync(path, 'utf8')) : {};
  const disabled = config.projects?.[root]?.disabledMcpServers;
  if (!Array.isArray(disabled) || !disabled.includes(SCOPED_NAME)) return { status: 'already' };
  config.projects[root].disabledMcpServers = disabled.filter((name) => name !== SCOPED_NAME);
  // Same atomic, mode-preserving write as disablePluginMcp — see its comment.
  const mode = fileExists ? statSync(path).mode & 0o777 : 0o600;
  const tmpPath = `${path}.tmp-${process.pid}`;
  writeFileSync(tmpPath, `${JSON.stringify(config, null, 2)}\n`, { mode });
  renameSync(tmpPath, path);
  return { status: 'enabled' };
}

const isMainModule = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    const args = process.argv.slice(2);
    const enable = args.includes('--enable');
    const targetPath = args.find((a) => a !== '--enable') ?? '.';
    console.log(JSON.stringify(enable ? enablePluginMcp(targetPath) : disablePluginMcp(targetPath), null, 2));
  } catch (err) {
    console.log(JSON.stringify({ status: 'error', message: err.message }, null, 2));
    process.exitCode = 0;
  }
}
