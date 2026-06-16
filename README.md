# Parcel Sweep

**Delivery route optimization — from manifest to last stop.**

Parcel Sweep is a full-stack prototype for last-mile package delivery operations. Generate realistic manifests from real OpenStreetMap addresses, split work across drivers, optimize routes with road-network timing, scan packages at the loading dock, and run a live driver experience with GPS tracking, proximity alerts, and fleet monitoring.

Built as a demo and starting point — not production-hardened, but end-to-end and feature-rich.

---

## Features

### Manifest & planning
- **Synthetic manifest generation** — pull real street addresses from OpenStreetMap (Overpass) for any ZIP code and create packages with tracking numbers, recipients, and service types
- **Multi-driver route proposals** — cluster nearby stops, optimize visit order (nearest-neighbor + 2-opt), and split into balanced routes for 1–N drivers
- **Station presets** — depot addresses for South Bend operations (Chippewa, McKinley Ave) or a custom start address
- **Package assignment** — assign unassigned packages to routes; scoped package lists per driver

### Route optimization
- **Stop clustering** — group packages within a configurable radius (default 50 m) into delivery stops
- **OSRM drive-time matrix** — leg durations and distances from [OSRM](https://project-osrm.org/) (public demo or self-hosted)
- **Cross-route proximity alerts** — flag when a stop on another driver's route is on the same block (default 120 m)
- **Re-optimize** — rerun the optimizer from the loading dock after scans change the manifest
- **Load order** — reverse-sequence loading list so the first delivery is loaded last

### Loading dock
- **Barcode / tracking scan** — keyboard-wedge scanner input or manual entry
- **Ghost package detection** — packages scanned but not on the manifest
- **Scan history** — live feedback as packages are loaded
- **Route status workflow** — loading → in delivery → completed

### Driver experience
- **Full-screen drive mode** — rotated Leaflet map that follows heading, with truck icon and route geometry
- **Live GPS via WebSocket** — broadcast position to admin and route viewers; demo mode simulates movement along the route path
- **Tiered proximity alerts** — warning (300 m), alert (120 m), arriving (40 m) with banner UI, vibration, speech synthesis, and browser notifications
- **Stop completion** — mark stops delivered; real-time updates via Socket.io
- **Turn-by-turn handoff** — open the next stop or full route in Google Maps
- **Map themes** — CARTO Voyager/Light/Night, OSM, Esri satellite

### Operations & admin
- **Dashboard** — manifests, package totals, active routes, quick links into each workflow stage
- **Admin fleet view** — live snapshot of all routes with driver, status, progress, ETA, and remaining stops (15 s auto-refresh)
- **Route plan view** — stop list, drive time/mileage summary, alert counts, export buttons
- **Route export** — download GPX, KML, or CSV for GPS devices and spreadsheets

### Infrastructure
- **SQLite persistence** — manifests, packages, routes, stops, and scan/delivery timestamps (WAL mode)
- **Single-service deploy** — Express serves the Vite-built frontend and API from one container
- **Health check** — `GET /health` reports geocoding and OSRM config
- **Docker + Railway + Render** — ready-to-deploy configs included

---

## Workflow

```
Sunday Hub (supervisor) ← Dashboard workflow stepper
       ↓
Import Manifest (CSV) → Validation results → Plan & split routes → Assign drivers
       ↓
Loading Dock (scan packages, optimize) → Route Plan (review, export route book)
       ↓
Start Delivery → Driver View (GPS, demo simulation, stop completion)
       ↓
Sunday Hub / Routes & Drivers (monitor fleet, readiness clocks, exceptions)
```

| View | Path | Nav label | Who |
|------|------|-----------|-----|
| Dashboard | `/` | Dashboard | Dispatcher / supervisor entry |
| Sunday Hub | `/sunday` | Sunday Hub | Supervisor |
| Manifest intake | `/manifests/new` | Manifests | Dispatcher |
| Manifest review | `/manifests/:id` | — | Dispatcher |
| Routes & Drivers | `/admin` | Routes & Drivers | Operations |
| Loading dock | `/routes/:id/load` | — | Loader |
| Route plan | `/routes/:id/route` | — | Dispatcher / driver prep |
| Driver mode | `/routes/:id/drive` | — | Driver |

Supervisor acceptance testing: see [docs/supervisor-acceptance-test.md](docs/supervisor-acceptance-test.md).

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  React + Vite frontend                                      │
│  Dashboard · Admin · Manifest · Loading Dock · Driver View  │
│  Leaflet maps · Socket.io client · Web Notifications        │
└──────────────────────────┬──────────────────────────────────┘
                           │ REST + WebSocket
┌──────────────────────────▼──────────────────────────────────┐
│  Express API (Node 22+)                                     │
│  manifests · routes · packages · admin · optimize-route     │
│  Socket.io — join:route, gps:update, stop events            │
└──────────┬───────────────────────────────┬──────────────────┘
           │                               │
    ┌──────▼──────┐                 ┌──────▼──────┐
    │   SQLite    │                 │  External   │
    │  (WAL)      │                 │  OSRM       │
    └─────────────┘                 │  Google /   │
                                    │  Nominatim  │
                                    │  Overpass   │
                                    └─────────────┘
```

**Route planning pipeline**

1. Geocode depot (Google Geocoding API or Nominatim fallback)
2. Cluster packages by proximity
3. Build drive-time matrix via OSRM
4. Optimize cluster visit order (nearest-neighbor → 2-opt)
5. Generate cross-route proximity alerts
6. Fetch leg geometries for map display
7. Split into per-driver routes when proposing multi-driver plans

---

## Tech stack

| Layer | Technologies |
|-------|--------------|
| Frontend | React 19, TypeScript, Vite, React Router, Leaflet + leaflet-rotate, Socket.io client |
| Backend | Node.js 22+, Express, TypeScript, Socket.io, node:sqlite |
| Data | SQLite (file-based, volume-mountable) |
| Routing | OSRM (configurable base URL) |
| Geocoding | Google Geocoding API (optional) or OpenStreetMap Nominatim |
| Addresses | OpenStreetMap Overpass API |

---

## Getting started

### Prerequisites

- **Node.js ≥ 22.5**
- npm (workspaces monorepo)

### Install & run (development)

```bash
git clone <repo-url>
cd parcel-sweep
npm install

# Optional: copy env template and add a Google Geocoding key
cp backend/.env.example backend/.env.local

npm run dev
```

This starts both services concurrently:

- **Backend** — `http://localhost:3000` (API + WebSocket)
- **Frontend** — `http://localhost:5173` (Vite dev server with HMR)

Open the frontend URL in your browser. Generate a manifest for ZIP `46614` (South Bend, IN — the default demo area) to get started quickly.

### Production build (local)

```bash
npm run start:prod
```

Builds frontend and backend, then serves everything from port 3000.

---

## Environment variables

Copy `backend/.env.example` to `backend/.env.local` for local development.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | HTTP server port |
| `FRONTEND_ORIGIN` | No | `http://localhost:5173` | CORS and Socket.io allowed origin |
| `GOOGLE_GEOCODING_API_KEY` | No | — | Improves depot geocoding; without it, Nominatim is used |
| `OSRM_BASE_URL` | No | `http://router.project-osrm.org` | OSRM server for drive matrices |
| `DB_PATH` | No | `./parcel-sweep.db` | SQLite database file path |

On Railway and Render, `FRONTEND_ORIGIN` is auto-detected from platform env vars when unset.

---

## Deployment

### Docker

```bash
docker build -t parcel-sweep .
docker run -p 3000:3000 -v parcel-sweep-data:/data parcel-sweep
```

The image runs `npm run build` then serves API + static frontend on port 3000. SQLite lives at `/data/parcel-sweep.db`.

### Railway

Uses the root `Dockerfile` and `railway.toml`. Mount a volume at `/data` and set `DB_PATH=/data/parcel-sweep.db` for persistent data.

### Render

Uses `render.yaml` — Docker runtime, health check on `/health`, 1 GB disk at `/data`.

---

## API overview

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Service health and config |
| `POST` | `/api/manifests/generate` | Generate manifest from ZIP + package count |
| `GET` | `/api/manifests` | List manifests |
| `GET` | `/api/manifests/:id` | Manifest detail + packages |
| `POST` | `/api/manifests/:id/propose-routes` | Multi-driver route proposals |
| `POST` | `/api/manifests/:id/routes/from-proposal` | Create route from a proposal |
| `GET` | `/api/routes` | List routes |
| `GET` | `/api/routes/:id` | Route detail with stops |
| `POST` | `/api/routes/:id/optimize` | Re-run optimizer |
| `POST` | `/api/routes/:id/scan` | Scan a tracking number |
| `POST` | `/api/routes/:id/start` | Begin delivery |
| `POST` | `/api/routes/:id/stops/:stopId/complete` | Mark stop delivered |
| `GET` | `/api/routes/:id/export/{gpx,kml,csv}` | Export route |
| `GET` | `/api/admin/routes` | Fleet ops snapshot |

**WebSocket events** (Socket.io)

- Client → server: `join:route`, `leave:route`, `gps:update`
- Server → client: `gps:update`, stop completion and route complete events

---

## Demo notes

This is a **prototype**, not a production system. Keep in mind:

- **No authentication** — admin and API endpoints are open; add auth before any real deployment
- **Public OSRM** — the default OSRM instance is rate-limited with no SLA; run your own for production
- **Synthetic data** — manifests use randomly generated recipients and USPS-style tracking numbers on real OSM addresses
- **Demo GPS** — driver view includes a simulated drive mode when live GPS is unavailable
- **SQLite** — fine for demos and single-node deploys; consider Postgres for multi-instance production

That said, the workflows are real: clustering, optimization, scanning, live tracking, alerts, and fleet monitoring all work together as a cohesive operations tool.

---

## Project structure

```
parcel-sweep/
├── backend/          Express API, route engine, SQLite
│   └── src/
│       ├── routes/       REST handlers
│       ├── services/     optimizer, geocoder, clusterer, alerts, export
│       └── db/           schema + helpers
├── frontend/         React SPA
│   └── src/
│       ├── pages/        Dashboard, Admin, Manifest, LoadingDock, RouteView, DriverView
│       └── components/   maps, scanner, alerts, package lists
├── Dockerfile        Single-service production image
├── render.yaml       Render Blueprint
└── railway.toml      Railway config
```

---

## Author

**[Stephen Weaver](https://stepweaver.dev)** — [λstepweaver](https://stepweaver.dev) · [GitHub](https://github.com/stephen) · [hello@stepweaver.dev](mailto:hello@stepweaver.dev)

Parcel Sweep is a full-stack prototype built by Stephen Weaver as a last-mile delivery operations demo. The ops HUD aesthetic draws from the terminal and systems design language of [stepweaver.dev](https://stepweaver.dev).

---

## License

Demo / prototype — add a license before open-sourcing or distributing.
