import { realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Node's default execFileSync maxBuffer is 1 MB; a `gh api --paginate` listing
// of an epic with hundreds of sub-issues overflows it, and the child dies with
// ENOBUFS — which listedChildren's catch turns into `null` ("lookup failed,
// stop"), silently abandoning a breakdown that in fact succeeded. 64 MB sits
// far above any realistic gh JSON payload; the output is already buffered in
// memory either way, so raising the ceiling costs nothing.
export const MAX_BUFFER = 64 * 1024 * 1024;

export function defaultExec(command, args, options) {
  return execFileSync(command, args, { encoding: 'utf8', maxBuffer: MAX_BUFFER, ...options }).toString();
}

function fetchIssue(issueNumber, targetPath, exec) {
  const output = exec('gh', ['issue', 'view', String(issueNumber), '--json', 'title,body'], { cwd: targetPath });
  return JSON.parse(output);
}

// null, not []: a transient API or permission failure is not the same fact as
// "this ticket has no children", and the skill routes the two differently —
// an empty list seeds candidates from the ticket's own body, while a failed
// lookup stops and says so. Collapsing them would seed a scan that silently
// ignored an epic's entire breakdown.
//
// --paginate matters here: this endpoint defaults to a 30-item page, and an
// epic with more sub-issues than that would otherwise lose every child past
// the first page with no error — a silently incomplete breakdown, not a
// failed one. For a JSON-array REST endpoint gh concatenates every page into
// one array before this process ever sees the output, so the flag alone is
// the fix; nothing downstream needs to know pagination happened at all.
//
// Keeps each entry's `title` from this listing response, not just its
// `number`: the endpoint returns the same issue resource `gh issue view`
// does, title included, and fetchChild's own follow-up fetch is only there
// for `body`. Discarding the title here would mean a child whose follow-up
// fetch fails loses its title for no reason — the exact fallback "the title
// alone is still a usable seed" depends on it surviving that failure.
function listedChildren(issueNumber, targetPath, exec) {
  try {
    const output = exec(
      'gh',
      ['api', `repos/{owner}/{repo}/issues/${issueNumber}/sub_issues`, '--paginate'],
      { cwd: targetPath },
    );
    const subs = JSON.parse(output);
    return Array.isArray(subs) ? subs.map((sub) => ({ number: sub.number, title: sub.title ?? null })) : null;
  } catch {
    return null;
  }
}

// A child whose own fetch fails keeps its place rather than dropping out of
// the list: the number is already known, and a breakdown quietly missing one
// item is worse than one carrying an obvious hole. Falls back to the title
// the listing already gave us — never to null — since that title did not
// depend on the fetch that just failed.
function fetchChild({ number, title: listedTitle }, targetPath, exec) {
  try {
    const { title, body } = fetchIssue(number, targetPath, exec);
    return { number, title, body };
  } catch {
    return { number, title: listedTitle, body: null };
  }
}

export function listChildren(targetPath, issueNumber, options = {}) {
  const { exec = defaultExec } = options;

  const { title, body } = fetchIssue(issueNumber, targetPath, exec);
  const listed = listedChildren(issueNumber, targetPath, exec);

  return {
    issueNumber,
    title,
    body,
    children: listed === null ? null : listed.map((child) => fetchChild(child, targetPath, exec)),
  };
}

const isMainModule = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    const issueNumber = Number(process.argv[2]);
    const targetPath = process.argv[3] ?? '.';
    console.log(JSON.stringify(listChildren(targetPath, issueNumber), null, 2));
  } catch (err) {
    console.log(JSON.stringify({ status: 'error', message: err.message }, null, 2));
    process.exitCode = 0;
  }
}
