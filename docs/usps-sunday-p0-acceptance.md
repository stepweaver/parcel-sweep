# USPS Sunday Evaluation — P0 Post-Implementation

**Date:** 2026-06-16  
**Environment:** Local dev after P0 implementation

## P0 exit criteria

| Criterion | Result | Evidence |
|---|---|---|
| Hold packages blocked from routing without override | Pass | `manifestRoutePlanner` filters via `packageIsRoutable`; create-from-proposal returns 409 on hold rows |
| Duplicate tracking blocked at import | Pass | `DUPLICATE_IN_FILE` / `DUPLICATE_IN_SYSTEM`; duplicate rows skipped on insert |
| Sunday dashboard three lanes | Pass | `GET /api/admin/sunday-dashboard` + `/sunday` UI |
| 2000-row import < 60s | Pass | 270ms import, 3.5s route propose (50 drivers) |
| Route proposals show duration/capacity warnings | Pass | `estimatedDurationMinutes`, `capacityPercent`, `infeasibilityReasons` on proposals |
| Supervisor override audit | Pass | `audit_events` table + `POST .../override` |

## Performance (post-P0)

| Function | 10 | 200 | 2000 | Target |
|---|---:|---:|---:|---|
| CSV import | 140ms | 30ms | 270ms | <2s / <10s / <60s |
| Route propose | — | — | 3494ms (50 drv) | <5min |

## Framework test matrix (post-P0)

| Scenario | Result | Notes |
|---|---|---|
| Small 10 / 1-5 drivers | Pass | CSV import + Sunday caps |
| Medium 200 / 5-20 drivers | Pass | Import 30ms |
| Large 2000 / 25-90 drivers | Pass | 43 proposals with capacity split; 7 idle drivers visible |
| M-B CSV import | Pass | |
| M-C mixed faults | Pass | 6 holds + 1 duplicate rejected in 2000 file |
| M-D duplicate hard-stop | Pass | In-file duplicate not inserted |
| M-E address normalization | Partial | Rule-based warnings; no USPS CASS |
| R-B capacity | Pass | Sunday mode enforces 80 pkg / 40 stops |
| R-F duration ceiling | Pass | `durationFeasible` + warnings |
| R-H infeasible plan | Pass | Infeasible proposals cannot create routes |
| A-F idle drivers | Pass | `idleDrivers` in propose summary |
| S-A/S-B start prechecks | Pass | Blocks start on manifest holds / zero loaded |
| S-C timers | Pass | DUT, load timer (LoadingDock), deliver timer (DriverView) |
| C-A KPI strip | Partial | Manifest-level counts; no full closeout |

## Bug candidates (post-P0)

| ID | Result |
|---|---|
| B1 Duplicate re-import | Pass — blocked with reason |
| B2 Bad addresses routed | Pass — hold/quarantine excludes from propose |
| B3 Capacity overflow | Pass — caps enforced in Sunday mode |
| B4 Time windows | Fail — deferred post-P0 |
| B5 POD required | Fail — deferred post-P0 |
| B6 No-scan alert | Partial — dashboard exception lane |
| B7 Edit audit | Partial — override audited; other edits not |
| B8 Role isolation | Fail — deferred post-P0 |
| B9 2000 import freeze | Pass |
| B10 CSV round-trip | Partial — template + import; no manifest export |

## Phase 2 backlog (explicitly deferred)

- USPS OAuth / AMS / DPV / IV-MTR integrations
- POD photo/signature capture
- Full exception taxonomy + RTS closeout
- RBAC / authentication
- OR-Tools multi-vehicle VRP
- Automated CI performance/security gates
- Time-window constraints
