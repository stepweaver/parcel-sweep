# Supervisor Acceptance Test — Parcel Sweep Sunday Operations

**Purpose:** Repeatable hands-on test mapping the USPS Sunday supervisory evaluation (10-step plan) to Parcel Sweep UI actions and test fixtures.

**Environment:** Local (`npm run dev`) or production (`https://parcel-sweep.up.railway.app`)

**Default hub:** ZIP 46614 / 46628, Chippewa depot, DUT 09:30

---

## Navigation entry points

| Module | Path | Top nav label |
|--------|------|---------------|
| Dashboard + workflow stepper | `/` | Dashboard |
| Sunday supervisor tower | `/sunday` | Sunday Hub |
| Manifest intake / review | `/manifests/new`, `/manifests/:id` | Manifests |
| Fleet + drivers | `/admin` | Routes & Drivers |
| Loading dock | `/routes/:id/load` | (from workflow stepper or route list) |
| Route plan + export | `/routes/:id/route` | (from Sunday Hub or loading dock) |
| Driver / simulation | `/routes/:id/drive?demo=1` | Sunday Hub → Run Driver Demo |

---

## Test fixtures

| File | Parcels | Use |
|------|--------:|-----|
| `testdata/manifests/small-clean-10.csv` | 10 | Smoke test, single-route flow |
| `testdata/manifests/edge-cases-only.csv` | ~12 | Address validation, holds, duplicates, hazmat |
| `testdata/manifests/medium-balanced-200.csv` | 200 | Multi-route balancing (proxy for 180-parcel eval) |
| `testdata/manifests/large-mixed-2000.csv` | 2000 | Stress / capacity (optional) |

**180-parcel evaluation scenario:** Import `medium-balanced-200.csv` once, or split into three imports (72 + 64 + 44) by filtering rows in a spreadsheet before upload.

---

## 10-step test plan

### 1. Open application and confirm operational entry point

1. Open `/`
2. Confirm top nav shows: **Dashboard**, **Sunday Hub**, **Manifests**, **Routes & Drivers**
3. Confirm **Sunday Hub Operations** card and **Sunday Workflow** stepper are visible
4. Open `/sunday` — confirm **Sunday Hub Operations Dashboard** heading and KPI strip

**Pass:** Manifest, route, and driver vocabulary appears in nav, headings, and noscript fallback (view page source).

---

### 2. Create sample manifests

1. Nav → **Manifests** (or Dashboard → Import Sunday manifest)
2. **Upload Sunday manifest** — paste or upload `small-clean-10.csv`
3. Set Hub ZIP `46614`, DUT `09:30`, today's operation date
4. Click **Import & validate**
5. Repeat with `edge-cases-only.csv` on a fresh manifest (delete prior test data if needed)

**Pass:** Manifest appears on Dashboard; detail page shows package counts and validation summary.

---

### 3. Test address quality controls

1. Open manifest imported from `edge-cases-only.csv`
2. Review **Validation results** table
3. Confirm holds for: missing street, bad ZIP, duplicate tracking, hazmat, oversize, PO box, etc.
4. Use **Override** on one held row with supervisor reason → **Release hold**

**Pass:** Bad rows quarantined; override releases row for routing.

---

### 4. Generate Sunday routes

1. On manifest detail, scroll to **Plan & split routes**
2. Confirm Sunday caps displayed (80 pkg / 40 stops / 300 min)
3. Set station Chippewa, driver count `3` (or `2` for small manifest)
4. Click **Plan N routes**
5. Review proposals for feasibility warnings

**Pass:** Multiple route proposals with parcel/stop counts and duration feasibility.

---

### 5. Assign routes to driver profiles

1. In **Assign drivers** proposal cards, set names: Driver A, Driver B, Driver C
2. Create each route from proposal
3. Open **Routes & Drivers** (`/admin`) — confirm drivers listed with status **Loading**

**Pass:** Each route has a driver name; fleet view lists all routes.

---

### 6. Validate route-release and loading readiness

1. Open **Sunday Hub** (`/sunday`)
2. Confirm **Route Readiness Clocks** panel (after first scan / begin tour)
3. Open **Loading Dock** for a route
4. Confirm DUT and **Load timer** (15-minute target) display
5. Scan packages; observe timer after first scan

**Pass:** DUT and load/deliver targets visible on Sunday Hub and Loading Dock.

---

### 7. Simulate runs and delivery exceptions

1. Complete loading → **Begin Tour** → **Route Plan**
2. **Export route book (CSV/GPX/KML)** from Route Plan
3. **Start Delivery** or use Sunday Hub → **Run Driver Demo**
4. In driver view, tap **Demo** to simulate movement
5. Complete stops; scan a ghost package at loading dock to create an exception

**Pass:** Demo mode runs; ghost packages surface in Sunday Hub **In Exception**.

---

### 8. Review completion and irregularity reporting

1. Return to **Sunday Hub**
2. Check **Projected vs. Actual** strip (planned routes, loaded, delivered, on street, exceptions)
3. Review **Not Ready**, **Ready to Dispatch**, **In Exception** lanes
4. Confirm KPI counts update after deliveries

**Pass:** Supervisor can assess operation state from `/sunday` without deep links.

---

### 9. Retest overflow and reassignment (partial)

1. On manifest detail, use **Unassigned packages** section to assign parcels to another route
2. Re-open **Plan & split routes** for remaining unassigned volume if needed

**Pass:** Packages reassigned without duplicate stops on same route. Full overflow re-optimize is a post-cert feature.

---

### 10. Export artifacts

1. From **Route Plan**, download CSV, GPX, and KML exports
2. Confirm CSV includes delivery sequence and addresses

**Pass:** Route book exports download successfully. Manifest-level and EOD summary exports are post-cert.

---

## Quick smoke (5 minutes)

```text
/ → Sunday Hub card visible
/manifests/new → import small-clean-10.csv
/manifests/:id → plan 2 routes, assign drivers
/routes/:id/load → scan all, begin tour
/sunday → KPIs and lanes render
```

---

## Post-certification gaps (not required for this test)

- USPS AMS/DPV street-level validation
- Formal irregularity taxonomy (second drop, non-scannable label, etc.)
- Audit log / end-of-day report UI
- Driver capability profiles
- Authentication and role-based default landing

See `docs/usps-sunday-evaluation.md` for baseline scenario matrix.
