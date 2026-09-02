import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { SCOPED_NAME } from './disable-plugin-mcp.mjs';

const PW_SIGNATURE = '@playwright/mcp';

export function isPlaywrightMcpServer(server, name) {
  if (!server || typeof server !== 'object') return false;
  const parts = [server.command, ...(Array.isArray(server.args) ? server.args : [])].filter((p) => typeof p === 'string');
  if (parts.join(' ').includes(PW_SIGNATURE)) return true;
  if (typeof server.url !== 'string' || server.url.length === 0) return false;
  if (/playwright[-/]mcp/i.test(server.url)) return true;
  // A url-based server exposes no package string, so the only remaining
  // signal is the server name. A command-based server must still match by
  // package only (never by name) — that fallback only applies here.
  // Residual limitation: a url-based Playwright server named without
  // "playwright" (e.g. "my-browser") cannot be detected.
  return typeof name === 'string' && /playwright/i.test(name);
}

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function collectFromServers(servers, meta, out, disabled = [], approve = null) {
  if (!servers || typeof servers !== 'object') return;
  for (const [name, server] of Object.entries(servers)) {
    if (disabled.includes(name)) continue;
    if (approve && !approve(name)) continue;
    if (isPlaywrightMcpServer(server, name)) out.push({ ...meta, server: name });
  }
}

// Minimal TOML read: only [mcp_servers.<name>] tables and their command/args.
// Handles both a single-line `args = [...]` array and a multi-line one that
// opens with `[` and closes with `]` on a later line. Residual limitation:
// an inline table or a `]`/`#` inside a quoted array element is not handled
// — acceptable for this minimal reader.
function parseArgsList(inner) {
  return inner
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter((s) => s.length > 0);
}

function parseCodexMcpServers(content) {
  const servers = {};
  let current = null;
  let pendingArgs = null; // accumulates a multi-line `args = [ ... ]` array
  for (const rawLine of content.split('\n')) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (pendingArgs !== null) {
      const close = line.indexOf(']');
      if (close === -1) {
        pendingArgs += line;
      } else {
        pendingArgs += line.slice(0, close);
        servers[current].args = parseArgsList(pendingArgs);
        pendingArgs = null;
      }
      continue;
    }
    const header = line.match(/^\[mcp_servers\.([^\]]+)\]$/);
    if (header) {
      current = header[1].replace(/^["']|["']$/g, '');
      servers[current] = {};
      continue;
    }
    if (line.startsWith('[')) { current = null; continue; }
    if (!current) continue;
    const cmd = line.match(/^command\s*=\s*["'](.+)["']$/);
    if (cmd) { servers[current].command = cmd[1]; continue; }
    const url = line.match(/^url\s*=\s*["'](.+)["']$/);
    if (url) { servers[current].url = url[1]; continue; }
    const args = line.match(/^args\s*=\s*\[(.*)\]$/);
    if (args) { servers[current].args = parseArgsList(args[1]); continue; }
    const argsOpen = line.match(/^args\s*=\s*\[(.*)$/);
    if (argsOpen) { pendingArgs = argsOpen[1]; continue; }
    const enabled = line.match(/^enabled\s*=\s*(true|false)$/);
    if (enabled) { servers[current].enabled = enabled[1] === 'true'; continue; }
  }
  return servers;
}

// Codex's own `enabled = false` on a [mcp_servers.<name>] table means the
// server is off — a missing field defaults to enabled (Codex's own default).
function collectCodexServers(servers, meta, out) {
  if (!servers || typeof servers !== 'object') return;
  const active = Object.fromEntries(Object.entries(servers).filter(([, server]) => server?.enabled !== false));
  collectFromServers(active, meta, out);
}

export function detectMcp(targetPath, homeDir = homedir()) {
  const found = [];
  // Claude Code keys ~/.claude.json's `projects` map by the absolute cwd
  // path, so resolve once here rather than trusting the caller's (possibly
  // relative) targetPath.
  const root = resolve(targetPath);

  // Claude Code — ~/.claude.json (user-global + project-scoped)
  const claudeHomePath = join(homeDir, '.claude.json');
  const claudeHome = readJson(claudeHomePath);

  // Claude Code — project .mcp.json. Approval state for these lives under a
  // SEPARATE key (disabledMcpjsonServers) from ~/.claude.json's own
  // mcpServers (disabledMcpServers) — do not conflate the two.
  const claudeProject = join(root, '.mcp.json');
  const claudeProjectEntry = claudeHome?.projects?.[root];
  // .mcp.json servers also need approval (enabledMcpjsonServers / enableAllProjectMcpServers)
  // before Claude Code will run them. That allowlist is authoritative only when actually
  // configured; when neither is set, fall back to disabled-list-only filtering so we don't
  // false-negative repos with no approval state recorded at all.
  const hasMcpjsonAllowlist = Array.isArray(claudeProjectEntry?.enabledMcpjsonServers) || claudeProjectEntry?.enableAllProjectMcpServers !== undefined;
  const approveMcpjsonServer = hasMcpjsonAllowlist
    ? (name) => claudeProjectEntry.enableAllProjectMcpServers === true || (claudeProjectEntry.enabledMcpjsonServers ?? []).includes(name)
    : null;
  collectFromServers(
    readJson(claudeProject)?.mcpServers,
    { harness: 'claude-code', file: claudeProject, scope: 'project' },
    found,
    claudeProjectEntry?.disabledMcpjsonServers ?? [],
    approveMcpjsonServer,
  );

  collectFromServers(claudeHome?.mcpServers, { harness: 'claude-code', file: claudeHomePath, scope: 'user' }, found, claudeHome?.disabledMcpServers ?? []);
  collectFromServers(
    claudeHome?.projects?.[root]?.mcpServers,
    { harness: 'claude-code', file: claudeHomePath, scope: 'project' },
    found,
    claudeHome?.projects?.[root]?.disabledMcpServers ?? [],
  );

  // Cursor — project + home
  const cursorProject = join(root, '.cursor', 'mcp.json');
  collectFromServers(readJson(cursorProject)?.mcpServers, { harness: 'cursor', file: cursorProject, scope: 'project' }, found);
  const cursorHome = join(homeDir, '.cursor', 'mcp.json');
  collectFromServers(readJson(cursorHome)?.mcpServers, { harness: 'cursor', file: cursorHome, scope: 'user' }, found);

  // Codex — project + home config.toml
  const codexProject = join(root, '.codex', 'config.toml');
  if (existsSync(codexProject)) {
    collectCodexServers(parseCodexMcpServers(readFileSync(codexProject, 'utf8')), { harness: 'codex', file: codexProject, scope: 'project' }, found);
  }
  // Codex resolves its USER config dir from $CODEX_HOME when set.
  const codexHomeDir = process.env.CODEX_HOME || join(homeDir, '.codex');
  const codexHome = join(codexHomeDir, 'config.toml');
  if (existsSync(codexHome)) {
    collectCodexServers(parseCodexMcpServers(readFileSync(codexHome, 'utf8')), { harness: 'codex', file: codexHome, scope: 'user' }, found);
  }

  const bundledDisabled = (claudeHome?.projects?.[root]?.disabledMcpServers ?? []).includes(SCOPED_NAME);

  return { found, bundledDisabled };
}

const isMainModule = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    const targetPath = process.argv[2] ?? '.';
    console.log(JSON.stringify(detectMcp(targetPath), null, 2));
  } catch (err) {
    console.log(JSON.stringify({ status: 'error', message: err.message }, null, 2));
    process.exitCode = 0;
  }
}
