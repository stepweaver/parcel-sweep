# USPS Sunday Evaluation — Parcel Sweep Baseline

**Date:** 2026-06-15  
**Environment:** Local dev (`npm run dev`), ZIP 46614 (South Bend), Chippewa depot  
**Purpose:** Pre-P0 acceptance baseline per supervisor evaluation framework

## Scenario matrix results

| Scenario | Packages | Drivers | Route build | Result | Notes |
|---|---:|---:|---:|---|---|
| Small under load | 10 | 1 | 1.4s | Pass | Single route produced; no overload warning |
| Small balanced | 10 | 2 | 1.4s | Pass | 2 short routes; no idle-driver visibility |
| Small overstaffed | 10 | 5 | — | Partial | Creates up to 5 routes; no explicit idle-driver parking |
| Medium under load | 200 | 5 | 2.8s | Partial | Routes built; capacity caps not enforced in UI |
| Medium balanced | 200 | 10 | 2.8s | Pass | Feasible split; no duration ceiling surfaced |
| Medium overstaffed | 200 | 20 | — | Partial | Stop-count split only; no fragmentation warning |
| Large under load | 2000 | 25 | — | Blocked | Generation capped at 200 packages |
| Large balanced | 2000 | 50 | — | Blocked | Awaiting CSV import |
| Large overstaffed | 2000 | 90 | — | Blocked | Awaiting CSV import |

## Performance measurements (baseline)

| Function | 10 packages | 200 packages | Target |
|---|---:|---:|---|
| Manifest generate | 1.6s | 1.2s | N/A (synthetic) |
| Route propose | 1.4s | 2.8s | <5s / <30s |
| CSV import | N/A | N/A | <10s / <60s |
| Driver reassignment | Not tested | — | <20s |
| Export manifest | Route CSV only | — | <10s |

## Bug candidate verification (B1–B10)

| ID | Test | Result | Evidence |
|---|---|---|---|
| B1 | Duplicate tracking re-import | Fail | No CSV import; DB UNIQUE would reject silently |
| B2 | Bad addresses routed | Partial | Ghosts excluded from planning; no pre-route quarantine |
| B3 | Capacity overflow | Fail | `maxPackagesPerRoute` / `maxStopsPerRoute` not passed from UI |
| B4 | Time-window conflicts | Fail | Not implemented |
| B5 | POD required before complete | Fail | Stop tap completes all packages without POD |
| B6 | No-scan route alert | Fail | No post-launch scan lag monitoring |
| B7 | Edit audit trail | Fail | Timestamps only; no actor/reason log |
| B8 | Role isolation | Fail | Open API; no authentication |
| B9 | 200-row import freeze | N/A | Generation only |
| B10 | CSV round-trip | Partial | Route export exists; no manifest re-import |

## Confirmed P0 blockers

1. No CSV manifest import or validation review screen
2. No quarantine/hold workflow for bad addresses, duplicates, hazmat, oversize
3. No Sunday operations mode (DUT, load/deliver timers, duration caps)
4. No supervisor control tower (Not Ready / Ready / In Exception)
5. Capacity and route-duration constraints not enforced in default workflow
6. No audit trail for supervisor overrides

## Post-P0 re-evaluation

Re-run this document's scenario matrix and B1–B10 after P0 implementation. Large (2000) scenarios become unblocked via `testdata/manifests/large-mixed-2000.csv`.
