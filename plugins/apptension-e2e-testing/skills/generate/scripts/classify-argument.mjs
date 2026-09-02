import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// A Jira key anchored as a whole string: an uppercase project code, then a
// numeric issue id. Shared with write-specs.mjs so the two agree on what a
// Jira ticket looks like.
export const JIRA_KEY_PATTERN = /^[A-Z][A-Z0-9]*-\d+$/;

function classifyUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return { kind: 'unusable', reason: `not a valid URL: ${value}` };
  }
  const { hostname, pathname } = url;
  if (hostname === 'github.com' || hostname === 'www.github.com') {
    const gh = pathname.match(/^\/([^/]+)\/([^/]+)\/issues\/(\d+)(?=\/|$)/);
    if (gh) return { kind: 'github', value: Number(gh[3]), tracker: 'github', owner: gh[1], repo: gh[2] };
    return { kind: 'unusable', reason: `github.com URL did not resolve to an owner/repo issue path: ${value}` };
  }
  const jira = pathname.match(/^\/browse\/([A-Z][A-Z0-9]*-\d+)(?=\/|$)/);
  if (jira) return { kind: 'jira', value: jira[1], tracker: 'jira', host: hostname };
  return { kind: 'unusable', reason: `URL resolved to neither a GitHub issue nor a Jira key: ${value}` };
}

export function classifyArgument(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (value.length === 0) return { kind: 'absent' };
  if (value.includes('://')) return classifyUrl(value);
  if (/^\d+$/.test(value)) return { kind: 'github', value: Number(value), tracker: 'github' };
  if (JIRA_KEY_PATTERN.test(value)) return { kind: 'jira', value, tracker: 'jira' };
  if (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(value) && /[a-z]/.test(value)) return { kind: 'user-path', value };
  return { kind: 'unusable', reason: `unrecognised argument shape: ${value}` };
}

const isMainModule = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  console.log(JSON.stringify(classifyArgument(process.argv[2]), null, 2));
}
