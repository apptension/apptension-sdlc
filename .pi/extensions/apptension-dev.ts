import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCAL_PLUGINS: Record<string, string> = {"apptension-e2e-testing":"../../plugins/apptension-e2e-testing/skills/","apptension-frontend-craft":"../../plugins/apptension-frontend-craft/skills/","apptension-review":"../../plugins/apptension-review/skills/","apptension-sdlc":"../../plugins/apptension-sdlc/skills/"};
const EXTERNAL_PLUGINS = new Set(["superpowers"]);

function parseSelector(selectorPath, raw) {
  let selector;
  try {
    selector = JSON.parse(raw);
  } catch {
    throw new Error(`[apptension-dev] ${selectorPath}: invalid JSON selector`);
  }
  if (
    selector === null ||
    typeof selector !== 'object' ||
    Array.isArray(selector) ||
    Object.getPrototypeOf(selector) !== Object.prototype
  ) {
    throw new Error(`[apptension-dev] ${selectorPath}: selector must be a plain object`);
  }
  for (const key of Object.keys(selector)) {
    if (key !== 'plugins') {
      throw new Error(
        `[apptension-dev] ${selectorPath}: unexpected selector property "${key}"`,
      );
    }
  }
  if (!Array.isArray(selector.plugins)) {
    throw new Error(`[apptension-dev] ${selectorPath}: plugins must be an array`);
  }
  for (const [index, name] of selector.plugins.entries()) {
    if (typeof name !== 'string') {
      throw new Error(`[apptension-dev] ${selectorPath}: plugins[${index}] must be a string`);
    }
  }
  return [...new Set(selector.plugins)];
}

function resolveSelectedPlugins({ worktree, configDir }) {
  const globalDir = configDir ?? process.env.PI_CODING_AGENT_DIR
    ?? path.join(os.homedir(), '.pi', 'agent');
  const projectPath = path.join(worktree, '.pi/apptension.json');
  const globalPath = path.join(globalDir, 'apptension.json');
  const selectorPath = fs.existsSync(projectPath) ? projectPath
    : fs.existsSync(globalPath) ? globalPath : undefined;
  if (!selectorPath) {
    console.warn(
      `[apptension-dev] no selector found at ${projectPath} or ${globalPath}; no skills registered`,
    );
    return { selected: [], selectorPath: undefined };
  }
  return {
    selected: parseSelector(selectorPath, fs.readFileSync(selectorPath, 'utf8')),
    selectorPath,
  };
}

function resolveSkillPaths(selected: string[], moduleUrl: string, selectorPath?: string): string[] {
  const paths: string[] = [];
  for (const name of [...new Set(selected)]) {
    if (EXTERNAL_PLUGINS.has(name)) {
      const hint = name === 'superpowers'
        ? 'pi install git:github.com/obra/superpowers'
        : 'install its upstream pi package';
      throw new Error(
        `[apptension-dev] ${name} uses a separate pi package; ${hint}`,
      );
    }
    if (!Object.hasOwn(LOCAL_PLUGINS, name)) {
      throw new Error(
        `[apptension-dev] ${selectorPath ? `${selectorPath}: ` : ''}unknown plugin "${name}"; selectable plugins: ${Object.keys(LOCAL_PLUGINS).join(', ')}`,
      );
    }
    const relativePath = LOCAL_PLUGINS[name];
    const absolutePath = path.resolve(fileURLToPath(new URL(relativePath, moduleUrl)));
    if (!paths.includes(absolutePath)) paths.push(absolutePath);
  }
  return paths;
}

export default function apptensionDevPiExtension(pi: {
  on(
    event: 'resources_discover',
    handler: () => Promise<{ skillPaths: string[] }>,
  ): void;
}): void {
  pi.on('resources_discover', async () => {
    const { selected, selectorPath } = resolveSelectedPlugins({ worktree: process.cwd() });
    return { skillPaths: resolveSkillPaths(selected, import.meta.url, selectorPath) };
  });
}
