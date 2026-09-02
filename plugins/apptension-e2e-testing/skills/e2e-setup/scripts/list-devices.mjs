import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveLocation } from './manifest.mjs';

// Classify a Playwright device-descriptor name into platform + form factor.
// Landscape variants and non-mobile entries return platform: null (filtered out).
export function classifyDevice(name) {
  // Skip landscape orientations and foldable cover screens — niche picks that
  // clutter the default list; a user who wants one can type its exact name.
  if (/ landscape$| Cover$/.test(name)) return { platform: null, form: null };
  const form = /iPad|Galaxy Tab/.test(name) ? 'tablet' : 'phone';
  let platform = null;
  if (/^iPhone|^iPad/.test(name)) platform = 'ios';
  else if (/^Pixel|^Galaxy/.test(name)) platform = 'android';
  return { platform, form };
}

// Filter a Playwright `devices` registry to the chosen platform/form, newest
// first (registry keys run oldest→newest, so we reverse), deduped by viewport
// so the list is short and each entry is a distinct screen size. Callers that
// want a specific model not shown can still pass its exact name through.
export function filterDevices(devices, { platform, form, dedupe = true } = {}) {
  const seen = new Set();
  const out = [];
  for (const name of Object.keys(devices).reverse()) {
    const { platform: p, form: f } = classifyDevice(name);
    if (!p) continue;
    if (platform && p !== platform) continue;
    if (form && f !== form) continue;
    const descriptor = devices[name];
    const viewport = `${descriptor.viewport.width}x${descriptor.viewport.height}`;
    // dedupe keeps the plain list short; the diverse pick keeps every model so
    // it can prefer base variants (e.g. "iPhone 17" over "iPhone 17 Pro").
    if (dedupe) {
      if (seen.has(viewport)) continue;
      seen.add(viewport);
    }
    out.push({ name, viewport, engine: descriptor.defaultBrowserType, form: f });
  }
  return out;
}

// Brand of a device, so a diverse pick can spread across makers.
export function brandOf(name) {
  if (/^iPhone|^iPad/.test(name)) return 'apple';
  if (/^Pixel/.test(name)) return 'google';
  if (/^Galaxy/.test(name)) return 'samsung';
  return 'other';
}

// Collapse tier/size variants to a generation-line key, so one entry per
// generation survives: "iPhone 17 Pro Max" / "17 Pro" / "17" / "17e" -> "iPhone 17",
// "Pixel 10 Pro XL" / "10 Pro" / "10" -> "Pixel 10".
export function lineKey(name) {
  return name
    .replace(/ landscape$/, '')
    .replace(/\s+(Pro Max|Pro|Plus|Max|Mini|Ultra|XL|FE)\b/gi, '')
    .replace(/(\d)(e|a)$/i, '$1') // iPhone 17e, Pixel 8a -> drop the trailing letter
    .replace(/\s+5G$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Rank a device's product line so mainstream flagships win over budget,
// foldable, and special-edition lines when picking a short default list.
// 0 = flagship, higher = more niche. (A user who wants a niche model types it.)
export function linePriority(name) {
  if (/^iPhone (SE|XR|XS)/.test(name)) return 2;
  if (/^iPhone Air/.test(name)) return 1;
  if (/^iPhone \d/.test(name)) return 0;
  if (/^iPad Pro/.test(name)) return 0;
  if (/^iPad/.test(name)) return 1;
  if (/^Pixel \d+a\b/.test(name)) return 1;
  if (/^Pixel/.test(name)) return 0;
  if (/^Galaxy S\d/.test(name)) return 0;
  if (/^Galaxy Tab S\d/.test(name)) return 0;
  if (/^Galaxy (Z|Note|Tab)/.test(name)) return 1;
  if (/^Galaxy A/.test(name)) return 2;
  return 1;
}

// From a newest-first, viewport-deduped list, pick `count` DIVERSE devices:
// one per generation-line (base variant preferred), then round-robin across
// brands so multi-brand platforms (Android: Pixel + Galaxy) don't return one
// brand's variants. Single-brand platforms (iOS) fall back to newest-per-
// generation (iPhone 17, 16, 15).
export function diversify(rows, count) {
  const byLine = new Map();
  for (const row of rows) {
    const key = lineKey(row.name);
    const kept = byLine.get(key);
    // prefer the base model of a generation (shortest name for that key)
    if (!kept || row.name.length < kept.name.length) byLine.set(key, row);
  }
  const byBrand = new Map();
  for (const row of byLine.values()) {
    const brand = brandOf(row.name);
    if (!byBrand.has(brand)) byBrand.set(brand, []);
    byBrand.get(brand).push(row);
  }
  // Within each brand, flagship lines first; stable sort keeps recency inside a
  // priority tier (so Galaxy S24 beats S23, and both beat a foldable).
  const queues = [...byBrand.values()].map((queue) =>
    queue.slice().sort((a, b) => linePriority(a.name) - linePriority(b.name)),
  );
  const out = [];
  for (let i = 0; out.length < count && queues.some((q) => q.length); i++) {
    const queue = queues[i % queues.length];
    if (queue.length) out.push(queue.shift());
  }
  return out.slice(0, count);
}

// Assemble every bucket the device wizard needs in one pass, so the SKILL calls
// this once and slices instead of invoking per platform/form. Each bucket mirrors
// the corresponding per-platform/form CLI call: phones = a diverse pick of 3,
// tablet = the single newest. Buckets are kept separate (not one flat list) so
// the wizard can still build an iOS page and an Android page from the result.
export function allBuckets(devices) {
  const pick = (platform, form, count) =>
    diversify(filterDevices(devices, { platform, form, dedupe: false }), count);
  return {
    ios: { phones: pick('ios', 'phone', 3), tablet: pick('ios', 'tablet', 1) },
    android: { phones: pick('android', 'phone', 3), tablet: pick('android', 'tablet', 1) },
  };
}

// Resolve @playwright/test from the suite location first, then the target
// root, returning the first that resolves. The e2e-setup skill installs
// Playwright into the suite location (mirrors install-browsers.mjs); a
// target-root install is the fallback. `options.location` mirrors the other
// scripts' explicit override, then the persisted root manifest, then the
// e2e/web default. Exported for testing.
export function loadDevices(targetPath, options = {}) {
  // Resolve to absolute: createRequire rejects a relative path, and the SKILL
  // invites a relative target (e.g. `webapp`).
  const base = resolve(targetPath);
  const webDir = resolveLocation(base, options);
  const candidates = [join(base, webDir, 'package.json'), join(base, 'package.json')];
  for (const from of candidates) {
    try {
      return createRequire(from)('@playwright/test').devices;
    } catch {
      // not resolvable from here — try the next location
    }
  }
  throw new Error(
    `@playwright/test is not resolvable from ${webDir} or the target root — install it in ${webDir} first (see the e2e-setup skill).`,
  );
}

const isMainModule = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const targetPath = process.argv[2] ?? '.';
  const flag = (name) => {
    const i = process.argv.indexOf(name);
    return i !== -1 ? process.argv[i + 1] : undefined;
  };
  const platform = flag('--platform'); // 'ios' | 'android'
  const form = flag('--form'); // 'phone' | 'tablet'
  const count = flag('--count'); // when set, return a diverse pick of N
  const location = flag('--location');
  let devices;
  try {
    devices = loadDevices(targetPath, { location });
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  // --all returns every wizard bucket in one call (the SKILL's default path);
  // the per-platform/form flags below stay for debugging a single bucket.
  if (process.argv.includes('--all')) {
    console.log(JSON.stringify(allBuckets(devices), null, 2));
    process.exit(0);
  }
  // Diverse pick works from the full list (dedupe off) so it can choose base
  // models; the plain list stays viewport-deduped.
  let rows = filterDevices(devices, { platform, form, dedupe: !count });
  if (count) rows = diversify(rows, Number(count));
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    for (const row of rows) console.log(`${row.name}  ${row.viewport}  ${row.engine}`);
  }
}
