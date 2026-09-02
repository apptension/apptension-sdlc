import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeEnvFile } from './env.mjs';

test('a key present with an empty value classifies as source blank, not kept', () => {
  const dir = mkdtempSync(join(tmpdir(), 'env-'));
  mkdirSync(join(dir, 'e2e', 'web'), { recursive: true });
  writeFileSync(join(dir, 'e2e', 'web', '.env'), 'E2E_USER_EMAIL=\nE2E_LOGIN_URL=https://app.test/login\n');

  const resolved = [
    { key: 'E2E_USER_EMAIL', value: '', source: 'blank' },
    { key: 'E2E_LOGIN_URL', value: '', source: 'blank' },
  ];
  const report = writeEnvFile(dir, resolved);

  const email = report.keys.find(({ key }) => key === 'E2E_USER_EMAIL');
  assert.equal(email.source, 'blank');
});

test('a key present with a non-empty value classifies as kept', () => {
  const dir = mkdtempSync(join(tmpdir(), 'env-'));
  mkdirSync(join(dir, 'e2e', 'web'), { recursive: true });
  writeFileSync(join(dir, 'e2e', 'web', '.env'), 'E2E_USER_EMAIL=\nE2E_LOGIN_URL=https://app.test/login\n');

  const resolved = [
    { key: 'E2E_USER_EMAIL', value: '', source: 'blank' },
    { key: 'E2E_LOGIN_URL', value: '', source: 'blank' },
  ];
  const report = writeEnvFile(dir, resolved);

  const loginUrl = report.keys.find(({ key }) => key === 'E2E_LOGIN_URL');
  assert.equal(loginUrl.source, 'kept');
});

test('a present-but-empty key with a resolved non-empty value is filled in place', () => {
  const dir = mkdtempSync(join(tmpdir(), 'env-'));
  mkdirSync(join(dir, 'e2e', 'web'), { recursive: true });
  writeFileSync(join(dir, 'e2e', 'web', '.env'), 'E2E_USER_EMAIL=\nE2E_LOGIN_URL=https://app.test/login\n');

  const resolved = [
    { key: 'E2E_USER_EMAIL', value: 'dev@example.com', source: '.env:TEST_EMAIL' },
    { key: 'E2E_LOGIN_URL', value: '', source: 'blank' },
  ];
  const report = writeEnvFile(dir, resolved);

  const email = report.keys.find(({ key }) => key === 'E2E_USER_EMAIL');
  assert.equal(email.source, '.env:TEST_EMAIL');
  assert.ok(report.added.includes('E2E_USER_EMAIL'));

  const out = readFileSync(join(dir, 'e2e', 'web', '.env'), 'utf8');
  assert.match(out, /^E2E_USER_EMAIL=dev@example\.com$/m);
  // the untouched sibling line is preserved verbatim
  assert.match(out, /^E2E_LOGIN_URL=https:\/\/app\.test\/login$/m);
});

test('a present-but-empty key with no resolved value stays empty and is not added', () => {
  const dir = mkdtempSync(join(tmpdir(), 'env-'));
  mkdirSync(join(dir, 'e2e', 'web'), { recursive: true });
  writeFileSync(join(dir, 'e2e', 'web', '.env'), 'E2E_USER_EMAIL=\n');

  const resolved = [{ key: 'E2E_USER_EMAIL', value: '', source: 'blank' }];
  const report = writeEnvFile(dir, resolved);

  const email = report.keys.find(({ key }) => key === 'E2E_USER_EMAIL');
  assert.equal(email.source, 'blank');
  assert.ok(!report.added.includes('E2E_USER_EMAIL'));

  const out = readFileSync(join(dir, 'e2e', 'web', '.env'), 'utf8');
  assert.match(out, /^E2E_USER_EMAIL=$/m);
});

test('a key present with a non-empty value is left untouched and not added', () => {
  const dir = mkdtempSync(join(tmpdir(), 'env-'));
  mkdirSync(join(dir, 'e2e', 'web'), { recursive: true });
  writeFileSync(join(dir, 'e2e', 'web', '.env'), 'E2E_LOGIN_URL=https://app.test/login\n');

  const resolved = [{ key: 'E2E_LOGIN_URL', value: 'https://resolved.example/login', source: '.env:LOGIN_URL' }];
  const report = writeEnvFile(dir, resolved);

  const loginUrl = report.keys.find(({ key }) => key === 'E2E_LOGIN_URL');
  assert.equal(loginUrl.source, 'kept');
  assert.ok(!report.added.includes('E2E_LOGIN_URL'));

  const out = readFileSync(join(dir, 'e2e', 'web', '.env'), 'utf8');
  assert.match(out, /^E2E_LOGIN_URL=https:\/\/app\.test\/login$/m);
});

// Finding B: parseEnvFile accepts leading whitespace, so a file with
// `  E2E_USER_EMAIL=` classifies as present-blank — the fill regex must match
// that same leading whitespace, or the resolved value never actually lands.
test('a present-but-empty key with leading whitespace is filled in place', () => {
  const dir = mkdtempSync(join(tmpdir(), 'env-'));
  mkdirSync(join(dir, 'e2e', 'web'), { recursive: true });
  writeFileSync(join(dir, 'e2e', 'web', '.env'), '  E2E_USER_EMAIL=\n');

  const resolved = [{ key: 'E2E_USER_EMAIL', value: 'dev@example.com', source: '.env:TEST_EMAIL' }];
  const report = writeEnvFile(dir, resolved);

  const email = report.keys.find(({ key }) => key === 'E2E_USER_EMAIL');
  assert.equal(email.source, '.env:TEST_EMAIL');
  assert.ok(report.added.includes('E2E_USER_EMAIL'));

  const out = readFileSync(join(dir, 'e2e', 'web', '.env'), 'utf8');
  // Exactly one E2E_USER_EMAIL line, carrying the resolved value — not left blank.
  const matches = out.match(/^\s*E2E_USER_EMAIL=.*$/gm) ?? [];
  assert.equal(matches.length, 1);
  assert.match(matches[0], /E2E_USER_EMAIL=dev@example\.com$/);
});

// Finding C: parseEnvFile keeps the LAST value of a duplicated key, but the
// generated config's own loader (see fullConfig in scaffold.mjs) stops at the
// FIRST match — so a duplicated key must be classified/filled by that first,
// runtime-effective occurrence, not parseEnvFile's last-wins view.
test('a duplicated key is classified by its first (runtime-effective) occurrence, not the last', () => {
  const dir = mkdtempSync(join(tmpdir(), 'env-'));
  mkdirSync(join(dir, 'e2e', 'web'), { recursive: true });
  writeFileSync(join(dir, 'e2e', 'web', '.env'), 'E2E_LOGIN_URL=\nE2E_LOGIN_URL=/login\n');

  const resolved = [{ key: 'E2E_LOGIN_URL', value: '', source: 'blank' }];
  const report = writeEnvFile(dir, resolved);

  const loginUrl = report.keys.find(({ key }) => key === 'E2E_LOGIN_URL');
  assert.equal(loginUrl.source, 'blank'); // not 'kept' — runtime loads the blank first line
});

test('an absent key is appended with its resolved value and source', () => {
  const dir = mkdtempSync(join(tmpdir(), 'env-'));
  mkdirSync(join(dir, 'e2e', 'web'), { recursive: true });
  writeFileSync(join(dir, 'e2e', 'web', '.env'), 'E2E_BASE_URL=http://localhost:3000\n');

  const resolved = [
    { key: 'E2E_BASE_URL', value: 'http://localhost:3000', source: 'PORT' },
    { key: 'E2E_USER_EMAIL', value: 'dev@example.com', source: '.env:TEST_EMAIL' },
  ];
  const report = writeEnvFile(dir, resolved);

  assert.ok(report.added.includes('E2E_USER_EMAIL'));
  const email = report.keys.find(({ key }) => key === 'E2E_USER_EMAIL');
  assert.equal(email.source, '.env:TEST_EMAIL');

  const out = readFileSync(join(dir, 'e2e', 'web', '.env'), 'utf8');
  assert.match(out, /^E2E_USER_EMAIL=dev@example\.com$/m);
});
