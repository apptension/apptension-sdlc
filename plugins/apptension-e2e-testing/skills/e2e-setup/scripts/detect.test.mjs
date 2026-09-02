import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detect } from './detect.mjs';
import { MANIFEST_NAME } from './manifest.mjs';

function makeRepo() {
  return mkdtempSync(join(tmpdir(), 'detect-language-'));
}

test('a JS repo root with a TS e2e package resolves ts', () => {
  const dir = makeRepo();
  mkdirSync(join(dir, 'e2e', 'web'), { recursive: true });
  writeFileSync(join(dir, 'e2e', 'web', 'tsconfig.json'), '{}');

  assert.equal(detect(dir).language, 'ts');
});

test('a TS repo root with a JS e2e package (existing .spec.js files) resolves js', () => {
  const dir = makeRepo();
  writeFileSync(join(dir, 'tsconfig.json'), '{}');
  mkdirSync(join(dir, 'e2e', 'web', 'specs', 'auth'), { recursive: true });
  writeFileSync(join(dir, 'e2e', 'web', 'specs', 'auth', 'login.spec.js'), '');

  assert.equal(detect(dir).language, 'js');
});

test('a repo with only a root tsconfig.json still resolves ts', () => {
  const dir = makeRepo();
  writeFileSync(join(dir, 'tsconfig.json'), '{}');

  assert.equal(detect(dir).language, 'ts');
});

test('a freshly-scaffolded suite with no specs written yet still resolves ts from the root', () => {
  const dir = makeRepo();
  writeFileSync(join(dir, 'tsconfig.json'), '{}');
  mkdirSync(join(dir, 'e2e', 'web', 'specs'), { recursive: true });
  mkdirSync(join(dir, 'e2e', 'web', 'pages'), { recursive: true });
  writeFileSync(join(dir, 'e2e', 'web', 'playwright.config.ts'), '');

  assert.equal(detect(dir).language, 'ts');
});

test("a TS suite's existing .spec.ts files decide the language even with a .js playwright config", () => {
  const dir = makeRepo();
  // No root or suite tsconfig.json at all — Playwright transpiles .ts specs
  // without one. The config extension must not be read as the JS signal.
  mkdirSync(join(dir, 'e2e', 'web', 'specs', 'auth'), { recursive: true });
  writeFileSync(join(dir, 'e2e', 'web', 'specs', 'auth', 'login.spec.ts'), '');
  writeFileSync(join(dir, 'e2e', 'web', 'playwright.config.js'), '');

  assert.equal(detect(dir).language, 'ts');
});

test('a suite with both .spec.ts and .spec.js files deterministically resolves ts', () => {
  const dir = makeRepo();
  mkdirSync(join(dir, 'e2e', 'web', 'specs', 'auth'), { recursive: true });
  // Written in an order that would give the wrong answer under a naive
  // "first entry readdirSync happens to return" rule.
  writeFileSync(join(dir, 'e2e', 'web', 'specs', 'auth', 'a-login.spec.js'), '');
  writeFileSync(join(dir, 'e2e', 'web', 'specs', 'auth', 'z-signup.spec.ts'), '');

  assert.equal(detect(dir).language, 'ts');
});

test('a Playwright report/output dir in the suite is not scanned for specs', () => {
  const dir = makeRepo();
  writeFileSync(join(dir, 'tsconfig.json'), '{}');
  mkdirSync(join(dir, 'e2e', 'web', 'test-results', 'some-run'), { recursive: true });
  // A stray file that would (wrongly) match if this dir weren't excluded.
  writeFileSync(join(dir, 'e2e', 'web', 'test-results', 'some-run', 'attachment.spec.js'), '');

  assert.equal(detect(dir).language, 'ts');
});

test('the e2e package dir comes from the persisted location, not a hardcoded e2e/web', () => {
  const dir = makeRepo();
  writeFileSync(join(dir, 'tsconfig.json'), '{}');
  writeFileSync(join(dir, MANIFEST_NAME), JSON.stringify({ location: 'services/e2e' }));

  // The relocated package is JS, despite the TS root.
  mkdirSync(join(dir, 'services', 'e2e', 'specs'), { recursive: true });
  writeFileSync(join(dir, 'services', 'e2e', 'specs', 'login.spec.js'), '');

  // A stray e2e/web with its own tsconfig.json must NOT be consulted — the
  // persisted answer names services/e2e, not the hardcoded default.
  mkdirSync(join(dir, 'e2e', 'web'), { recursive: true });
  writeFileSync(join(dir, 'e2e', 'web', 'tsconfig.json'), '{}');

  assert.equal(detect(dir).language, 'js');
});

test('an explicit specDir wins over the default e2e/web when nothing is persisted', () => {
  const dir = makeRepo();
  // No root tsconfig.json, no .e2e-scaffold.json — a suite never onboarded
  // via e2e-setup. Its real location (services/e2e) is TS; nothing at the
  // default e2e/web exists at all.
  mkdirSync(join(dir, 'services', 'e2e', 'specs'), { recursive: true });
  writeFileSync(join(dir, 'services', 'e2e', 'specs', 'login.spec.ts'), '');

  assert.equal(detect(dir, { specDir: 'services/e2e/specs' }).language, 'ts');
});
