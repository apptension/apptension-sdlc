import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCAL_PLUGINS = {"apptension-e2e-testing":"../../plugins/apptension-e2e-testing/skills/","apptension-frontend-craft":"../../plugins/apptension-frontend-craft/skills/","apptension-review":"../../plugins/apptension-review/skills/","apptension-sdlc":"../../plugins/apptension-sdlc/skills/"};
const LOCAL_COMMANDS = {"apptension-sdlc":{"work-issue":{"description":"Work an issue end to end, from ticket to draft PR.","template":"\nWork issue $ARGUMENTS.\n\nUse the `dev-flow` skill and follow it exactly, starting at step 1. Do not\nskip the pre-flight checks.\n\nDo not skip the design gate's confirmation step on the direct track. The\nmicro track waives that confirmation by its own rule in `dev-flow` — taking\nit is following the gate, not skipping it.\n"}}};
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
  const globalDir = configDir ?? process.env.OPENCODE_CONFIG_DIR
    ?? path.join(os.homedir(), '.config', 'opencode');
  const projectPath = path.join(worktree, '.opencode/apptension.json');
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


function registerSelectedPlugins(
  config,
  selected,
  moduleUrl = import.meta.url,
  selectorPath,
  registeredCommands,
) {
  config.skills ??= {};
  config.skills.paths ??= [];
  config.command ??= {};
  for (const name of [...new Set(selected)]) {
    if (EXTERNAL_PLUGINS.has(name)) {
      throw new Error(
        `[apptension-dev] ${name} uses a separate OpenCode package installation`,
      );
    }
    if (!Object.hasOwn(LOCAL_PLUGINS, name)) {
      throw new Error(
        `[apptension-dev] ${selectorPath ? `${selectorPath}: ` : ''}unknown plugin "${name}"; selectable plugins: ${Object.keys(LOCAL_PLUGINS).join(', ')}`,
      );
    }
    const relativePath = LOCAL_PLUGINS[name];
    if (relativePath !== null) {
      const absolutePath = path.resolve(fileURLToPath(new URL(relativePath, moduleUrl)));
      if (!config.skills.paths.includes(absolutePath)) config.skills.paths.push(absolutePath);
    }
    for (const [commandName, command] of Object.entries(LOCAL_COMMANDS[name] ?? {})) {
      const existingOwner = registeredCommands.get(commandName);
      if (existingOwner !== undefined) {
        if (existingOwner === name) continue;
        throw new Error(
          `[apptension-dev] command "${commandName}" from plugin "${name}" conflicts with plugin "${existingOwner}"`,
        );
      }
      if (Object.hasOwn(config.command, commandName)) {
        throw new Error(
          `[apptension-dev] command "${commandName}" from plugin "${name}" conflicts with existing config command`,
        );
      }
      config.command[commandName] = command;
      registeredCommands.set(commandName, name);
    }
  }
}

export const ApptensionDevPlugin = async ({ worktree }) => {
  const registeredCommands = new Map();
  return {
    config: async (config) => {
      const { selected, selectorPath } = resolveSelectedPlugins({ worktree });
      registerSelectedPlugins(config, selected, import.meta.url, selectorPath, registeredCommands);
    },
  };
};
