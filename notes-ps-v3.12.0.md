### v3.12.0
  - Front 2 of the architecture pass complete: detect -> policy -> action separation. `PowerSentinel-detect.sh` (pure device-state reads), `PowerSentinel-policy.sh` (pure decisions), and `PowerSentinel-actions.sh` (the only place that touches the system) now cleanly separate what used to be one large daemon file.
  - Fixed two real bugs found while doing this: manually-specified CPU core selection could restore the wrong governor on disable, or apply powersave to the wrong core on enable. Both only affect manual core selection, not "auto" mode.
  - No user-facing behavior changes beyond the two bug fixes - internal restructuring, with system-touching order preserved exactly as before.
