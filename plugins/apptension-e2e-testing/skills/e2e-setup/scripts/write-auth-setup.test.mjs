import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AUTH_SETUP_MARKER, renderAuthSetup } from './scaffold.mjs';
import { writeAuthSetup, flagValue } from './write-auth-setup.mjs';

const VALID_OPTS = {
  emailSelector: "getByLabel('Email')",
  passwordSelector: "getByLabel('Password')",
  submitSelector: "getByRole('button', { name: /sign in/i })",
  waitUrl: "'**/'",
};

const OTHER_OPTS = {
  emailSelector: "getByTestId('email')",
  passwordSelector: "getByTestId('password')",
  submitSelector: "getByTestId('submit')",
  waitUrl: "'**/dashboard'",
};

test('stub output keeps commented login lines and says it is a stub', () => {
  const out = renderAuthSetup();
  assert.match(out, /\/\/ await page\.getByLabel/); // login lines commented
  assert.match(out, /stub/i);                        // states it is a stub
  assert.match(out, /from '\.\/fixtures\/base'/);    // base import kept
  assert.ok(out.includes(AUTH_SETUP_MARKER));         // carries the generated marker
});

test('working output has no commented login lines and reads process.env', () => {
  const out = renderAuthSetup({
    emailSelector: "getByLabel('Email')",
    passwordSelector: "getByLabel('Password')",
    submitSelector: "getByRole('button', { name: /sign in/i })",
    waitUrl: "'**/'",
  });
  assert.doesNotMatch(out, /\/\/ await page\.getByLabel/); // no commented login
  assert.match(out, /process\.env\.E2E_USER_EMAIL/);
  assert.match(out, /process\.env\.E2E_USER_PASSWORD/);
  assert.match(out, /process\.env\.E2E_LOGIN_URL/);
  assert.match(out, /getByRole\('button', \{ name: \/sign in\/i \}\)/);
  assert.match(out, /from '\.\/fixtures\/base'/);
  assert.ok(out.includes(AUTH_SETUP_MARKER));              // carries the generated marker
});

test('writeAuthSetup overwrites e2e/web/auth.setup.ts with the working file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'auth-setup-'));
  mkdirSync(join(dir, 'e2e', 'web'), { recursive: true });
  writeAuthSetup(dir, VALID_OPTS);
  const out = readFileSync(join(dir, 'e2e', 'web', 'auth.setup.ts'), 'utf8');
  assert.doesNotMatch(out, /\/\/ await page\.getByLabel/);
  assert.match(out, /process\.env\.E2E_LOGIN_URL/);
});

test('writeAuthSetup throws when a required opt is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'auth-setup-'));
  mkdirSync(join(dir, 'e2e', 'web'), { recursive: true });
  const { waitUrl, ...incomplete } = VALID_OPTS;
  assert.throws(() => writeAuthSetup(dir, incomplete), /waitUrl/);
  assert.equal(existsSyncCheck(dir), false); // nothing written before the throw
});

function existsSyncCheck(dir) {
  try {
    readFileSync(join(dir, 'e2e', 'web', 'auth.setup.ts'), 'utf8');
    return true;
  } catch {
    return false;
  }
}

test('writeAuthSetup refuses to overwrite a customized (non-stub) auth.setup.ts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'auth-setup-'));
  mkdirSync(join(dir, 'e2e', 'web'), { recursive: true });
  const customized = "// hand-authored login\nawait page.goto('/custom-login');\n";
  writeFileSync(join(dir, 'e2e', 'web', 'auth.setup.ts'), customized);

  const result = writeAuthSetup(dir, VALID_OPTS);

  assert.equal(result.written, null);
  assert.equal(result.refused, 'e2e/web/auth.setup.ts');
  assert.match(result.reason, /not written by e2e-setup/);
  const out = readFileSync(join(dir, 'e2e', 'web', 'auth.setup.ts'), 'utf8');
  assert.equal(out, customized); // untouched
});

test('writeAuthSetup allows a retry: rewriting with different opts overwrites the prior working file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'auth-setup-'));
  mkdirSync(join(dir, 'e2e', 'web'), { recursive: true });

  const first = writeAuthSetup(dir, VALID_OPTS);
  assert.equal(first.written, 'e2e/web/auth.setup.ts');

  const second = writeAuthSetup(dir, OTHER_OPTS);

  assert.equal(second.written, 'e2e/web/auth.setup.ts');
  assert.equal(second.refused, undefined);
  const out = readFileSync(join(dir, 'e2e', 'web', 'auth.setup.ts'), 'utf8');
  assert.match(out, /getByTestId\('email'\)/);
  assert.match(out, /'\*\*\/dashboard'/);
  assert.doesNotMatch(out, /getByLabel\('Email'\)/);
});

test('writeAuthSetup overwrites when the existing file is exactly the stub', () => {
  const dir = mkdtempSync(join(tmpdir(), 'auth-setup-'));
  mkdirSync(join(dir, 'e2e', 'web'), { recursive: true });
  writeFileSync(join(dir, 'e2e', 'web', 'auth.setup.ts'), renderAuthSetup());

  const result = writeAuthSetup(dir, VALID_OPTS);

  assert.equal(result.written, 'e2e/web/auth.setup.ts');
  const out = readFileSync(join(dir, 'e2e', 'web', 'auth.setup.ts'), 'utf8');
  assert.doesNotMatch(out, /\/\/ await page\.getByLabel/);
  assert.match(out, /process\.env\.E2E_LOGIN_URL/);
});

// Finding A: a repo scaffolded by an OLDER plugin version has a stub with no
// AUTH_SETUP_MARKER (the marker didn't exist yet), but it still carries the
// commented placeholder login line. That legacy stub must be regeneratable too,
// or the guard strands exactly the repos that most need the working login written.
test('writeAuthSetup overwrites a legacy (pre-marker) stub', () => {
  const dir = mkdtempSync(join(tmpdir(), 'auth-setup-'));
  mkdirSync(join(dir, 'e2e', 'web'), { recursive: true });
  const legacyStub = `import { test as setup } from './fixtures/base';

const authFile = '.auth/user.json';

setup('authenticate', async ({ page }) => {
  // STUB — not a working login.
  await page.goto('/');
  // await page.getByLabel('Email').fill(process.env.E2E_USER_EMAIL);
  // await page.getByLabel('Password').fill(process.env.E2E_USER_PASSWORD);
  // await page.getByRole('button', { name: 'Sign in' }).click();
  // await page.waitForURL('**/');

  await page.context().storageState({ path: authFile });
});
`;
  assert.doesNotMatch(legacyStub, new RegExp(AUTH_SETUP_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  writeFileSync(join(dir, 'e2e', 'web', 'auth.setup.ts'), legacyStub);

  const result = writeAuthSetup(dir, VALID_OPTS);

  assert.equal(result.written, 'e2e/web/auth.setup.ts');
  const out = readFileSync(join(dir, 'e2e', 'web', 'auth.setup.ts'), 'utf8');
  assert.doesNotMatch(out, /\/\/ await page\.getByLabel/);
  assert.match(out, /process\.env\.E2E_LOGIN_URL/);
});

// Finding D: `--email --password X` must not let email's value be the literal
// string '--password' — a value that is undefined or itself looks like a flag
// counts as absent, so the required-opts check catches it before any write.
test('flagValue treats a value that looks like another flag, or a missing value, as absent', () => {
  assert.equal(flagValue(['--email', '--password', 'X'], '--email'), undefined);
  assert.equal(flagValue(['--email'], '--email'), undefined);
  assert.equal(flagValue(['--email', 'getByLabel(\'Email\')'], '--email'), "getByLabel('Email')");
});
