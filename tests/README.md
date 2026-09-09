# PowerSentinel test suite

A real, persisted set of regression tests - not another throwaway
`/tmp` simulation script. Every test here exists because it verifies
something that was once a real, shipped bug (see each file's own
header comment for which one, and how it was found).

## Running

```bash
bash tests/run.sh
```

Requires `bash` and `jq` on whatever machine runs this (a normal dev
machine or CI - **never** the Android device itself; these tests
source the real `system/bin/PowerSentinel-*.sh` files directly and
exercise their actual logic, with only the handful of
Android-specific primitives a given test needs stubbed out - `dumpsys`
via a fake `PATH` binary, `getconf`/`is_device`/`DETECT_BATTERY_*` as
plain shell functions/variables).

## Adding a new test

1. Create `tests/test_<something>.sh`.
2. Define exactly one function: `run_tests() { ... }`.
3. Inside it, `source` the real file(s) under test
   (`$REPO_ROOT/system/bin/PowerSentinel-whatever.sh`), stub only what
   that file needs from outside itself, and call `assert_*` helpers
   from `tests/lib/assert.sh` (`assert_eq`, `assert_true`,
   `assert_valid_json`, `assert_json_field`, `assert_single_line`).
4. `bash tests/run.sh` picks it up automatically - no registration
   needed anywhere else.

Before trusting a new test, deliberately break the fix it's meant to
guard (comment it out, revert the one line that mattered) and confirm
the test actually fails - then put the fix back. A test that has never
been seen to fail isn't verified to catch anything.

**Cleanup gotcha:** bash traps are process-scoped, not
function-scoped. A `trap ... RETURN` set inside `run_tests()` fires
when any `source`d script finishes too, not just when `run_tests()`
itself returns - it'll delete a temp dir far too early. `trap ...
EXIT` avoids that but then fires again later once local variables are
already out of scope. Simplest and safest: skip traps entirely and
`rm -rf` your temp dir/file explicitly at the end of `run_tests()`.
