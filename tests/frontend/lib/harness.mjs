// tests/frontend/lib/harness.mjs
//
// Minimal, dependency-light (just jsdom, already a frontend devDependency)
// test harness for the frontend's plain ES modules - formalizes the exact
// pattern used ad-hoc, over and over, throughout this project's real bug
// investigations (stub a module's imports with inline replacements, write
// the patched source to a temp file, import it, assert on the result) so
// writing a new frontend test doesn't mean re-deriving that plumbing from
// scratch every time.
//
// Why this exists at all: every frontend bug found this session
// (filterBootRestartNoise's boot-restart-noise filter, activeAdaptiveTier
// reading real state instead of recomputing it, switchLogSubTab's inline
// style override, playSlideInAnimation's class handling, render()'s
// sub-renderer isolation) was verified with a hand-written, throwaway
// jsdom script that never outlived the conversation turn it was written
// in - identical in spirit to what the backend's tests/ directory already
// fixed for bash. This is that same fix, for the frontend.

import { JSDOM } from '../../../frontend/node_modules/jsdom/lib/api.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const FRONTEND_SRC = path.resolve(__dirname, '../../../frontend/src');

export let TESTS_RUN = 0;
export let TESTS_FAILED = 0;

export function resetCounts() { TESTS_RUN = 0; TESTS_FAILED = 0; }

function fmt(v) {
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch (e) { return String(v); }
}

export function assertEq(expected, actual, desc) {
  TESTS_RUN++;
  const a = fmt(expected), b = fmt(actual);
  if (a === b) return true;
  TESTS_FAILED++;
  console.log(`  \x1b[31mFAIL\x1b[0m ${desc || 'assertEq'}`);
  console.log(`       esperado: ${a}`);
  console.log(`       obtenido: ${b}`);
  return false;
}

export function assertTrue(cond, desc) {
  TESTS_RUN++;
  if (cond) return true;
  TESTS_FAILED++;
  console.log(`  \x1b[31mFAIL\x1b[0m ${desc || 'assertTrue'} (se esperaba una condicion verdadera)`);
  return false;
}

export function assertDeepEq(expected, actual, desc) {
  return assertEq(JSON.stringify(expected), JSON.stringify(actual), desc);
}

// setupDom(html) - creates a fresh jsdom document/window and installs them
// as globals (document/window), the way every real frontend module expects
// to find them at import time. Call this BEFORE loadModule().
export function setupDom(html = '<!DOCTYPE html><html><body></body></html>') {
  const dom = new JSDOM(html);
  global.document = dom.window.document;
  global.window = dom.window;
  return dom;
}

// loadModule(relativeSrcPath, { replacements, exportNames }) - reads a real
// frontend/src file, applies each [pattern, replacement] pair in order
// (exactly the manual src.replace() calls used throughout this session's ad
// hoc tests - pattern can be a string or RegExp), appends `export { ... }`
// for any internal (not already exported) names the test needs, writes the
// patched source to a fresh temp file, and imports it.
//
// Replacements exist to stub OUT this module's own imports (so a test
// never has to load half the app to test one function) and to rename/
// re-expose internal functions - never to change the logic under test
// itself. Keep replacements to import lines and export additions; if a
// test needs to reach further into a file's internals than that, the
// function probably belongs in its own module instead.
export async function loadModule(relativeSrcPath, { replacements = [], exportNames = [] } = {}) {
  const fullPath = path.join(FRONTEND_SRC, relativeSrcPath);
  let src = fs.readFileSync(fullPath, 'utf8');
  for (const [pattern, replacement] of replacements) {
    const before = src;
    src = src.replace(pattern, replacement);
    if (src === before) {
      throw new Error(`loadModule(${relativeSrcPath}): replacement did not match anything - pattern: ${pattern}`);
    }
  }
  if (exportNames.length) {
    src += `\nexport { ${exportNames.join(', ')} };\n`;
  }
  const tmpPath = path.join(os.tmpdir(), `ps-frontend-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
  fs.writeFileSync(tmpPath, src);
  try {
    return await import(`file://${tmpPath}`);
  } finally {
    fs.unlink(tmpPath, () => {});
  }
}

// A no-op i18n stub good enough for most tests: t('some.key') -> 'some.key'
// (with {placeholders} substituted literally when vars are passed), so
// assertions can check against the KEY rather than needing real translated
// strings (which change independently of the logic being tested).
export const STUB_T = "const t = (k, vars) => { if (!vars) return k; let s = k; Object.keys(vars).forEach((kk) => { s = s.split('{' + kk + '}').join(vars[kk]); }); return s; };";

// extractFunction(relativeSrcPath, functionName) - for the rare case a
// function is small, self-contained (no meaningful dependency on the rest
// of its module), but its OWN module has top-level side effects (wiring up
// real UI elements immediately on import) that make loadModule()'s
// "stub the imports and load the whole file" approach impractical. Pulls
// just that one `function name(...) { ... }` block out of the real source
// by regex and evals it standalone - reads the file fresh every run, so a
// real change to the function is still caught, without executing anything
// else in that module. Only use this when loadModule() genuinely doesn't
// fit; loading the real module is always the better default.
export function extractFunction(relativeSrcPath, functionName) {
  const fullPath = path.join(FRONTEND_SRC, relativeSrcPath);
  const src = fs.readFileSync(fullPath, 'utf8');
  const re = new RegExp(`function ${functionName}\\([^)]*\\)\\s*\\{`);
  const m = re.exec(src);
  if (!m) throw new Error(`extractFunction: "${functionName}" not found in ${relativeSrcPath}`);
  let depth = 0, i = m.index + m[0].length - 1, end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end === -1) throw new Error(`extractFunction: unbalanced braces reading "${functionName}" in ${relativeSrcPath}`);
  const code = src.slice(m.index, end);
  // eslint-disable-next-line no-eval
  return (0, eval)(`(${code.replace(/^function\s+\w+/, 'function')})`);
}

// extractConst(relativeSrcPath, constName) - same idea as
// extractFunction() above, but for a `const name = (...) => { ... }`
// arrow function defined inline inside another function (e.g. render()'s
// own safeRender helper) rather than a top-level `function name(...)`.
export function extractConst(relativeSrcPath, constName) {
  const fullPath = path.join(FRONTEND_SRC, relativeSrcPath);
  const src = fs.readFileSync(fullPath, 'utf8');
  const re = new RegExp(`const ${constName} = \\([^)]*\\) => \\{`);
  const m = re.exec(src);
  if (!m) throw new Error(`extractConst: "${constName}" not found in ${relativeSrcPath}`);
  let depth = 0, i = m.index + m[0].length - 1, end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end === -1) throw new Error(`extractConst: unbalanced braces reading "${constName}" in ${relativeSrcPath}`);
  const code = src.slice(m.index, end).replace(new RegExp(`^const ${constName} = `), '');
  // eslint-disable-next-line no-eval
  return (0, eval)(`(${code})`);
}
