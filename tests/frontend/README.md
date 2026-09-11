# PowerSentinel frontend test suite

The same idea as `tests/README.md` (the bash suite), for the frontend.
Every test here exists because it verifies something that was once a
real, shipped bug (see each file's own header comment for which one).

## Running

```bash
node tests/frontend/run.mjs
```

Requires Node.js and the frontend's own `node_modules` (specifically
`jsdom`, already a dependency of `frontend/`) - run `npm install` inside
`frontend/` first if that directory is missing.

## Adding a new test

1. Create `tests/frontend/test_<something>.mjs`.
2. Export exactly one function: `export async function runTests() { ... }`.
3. Inside it, get the real function under test via one of:
   - `loadModule(relativeSrcPath, { replacements, exportNames })` - reads
     a real `frontend/src/...` file, stubs out its imports (replacements
     is a list of `[pattern, replacementCode]` pairs, applied with
     `String.replace`), adds `export { ... }` for any internal names the
     test needs, and imports the patched result. The right default for
     almost everything - most frontend functions live in a module whose
     OTHER imports are easy to stub.
   - `extractFunction(relativeSrcPath, name)` / `extractConst(relativeSrcPath, name)`
     - for the rare case the function's own module has real top-level
       side effects (wiring up actual UI elements on import) that make
       loading the whole module impractical, and the function itself has
       no meaningful dependency on the rest of that module. Reads the
       function's source fresh every run and evals it standalone, so a
       real change to the function is still caught.
4. Call `setupDom(html)` first if the code under test touches
   `document`/`window`.
5. Use `assertEq`, `assertTrue`, `assertDeepEq` from `./lib/harness.mjs`.
6. `node tests/frontend/run.mjs` picks it up automatically - no
   registration needed anywhere else.

Before trusting a new test, deliberately break the fix it's meant to
guard and confirm the test actually fails - then put the fix back. A
test that has never been seen to fail isn't verified to catch anything.
