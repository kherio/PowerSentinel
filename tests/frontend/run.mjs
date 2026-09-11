#!/usr/bin/env node
// tests/frontend/run.mjs - PowerSentinel frontend test suite runner.
//
// Usage: node tests/frontend/run.mjs (from anywhere - resolves paths
// relative to this script's own location).
//
// Each test_*.mjs file must export an async function `runTests()`. Files
// run sequentially, each getting a fresh pass/fail counter (module-level
// state in harness.mjs is reset between files) - one file's assertion
// failures never stop the rest from running, matching the bash suite's
// own behavior.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as harness from './lib/harness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('PowerSentinel frontend test suite');
console.log(`node: ${process.version}`);

const files = fs.readdirSync(__dirname)
  .filter((f) => f.startsWith('test_') && f.endsWith('.mjs'))
  .sort();

let totalRun = 0;
let totalFailed = 0;

for (const file of files) {
  console.log(`\n--- ${file.replace(/\.mjs$/, '')} ---`);
  harness.resetCounts();
  try {
    const mod = await import(path.join(__dirname, file));
    await mod.runTests();
  } catch (e) {
    console.log(`  \x1b[31mERROR\x1b[0m: ${file} aborto (fallo real del script, no una aserción)`);
    console.log(`       ${e.stack || e.message}`);
    harness.assertTrue(false, `${file} no lanzo una excepcion al ejecutarse`);
  }
  totalRun += harness.TESTS_RUN;
  totalFailed += harness.TESTS_FAILED;
}

console.log('\n============================================');
if (totalFailed === 0) {
  console.log(`\x1b[32m${totalRun}/${totalRun} pruebas correctas\x1b[0m`);
  process.exit(0);
} else {
  console.log(`\x1b[31m${totalFailed}/${totalRun} pruebas fallidas\x1b[0m`);
  process.exit(1);
}
