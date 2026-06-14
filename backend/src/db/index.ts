import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultDbPath = path.resolve(__dirname, "../../../parcel-sweep.db");
const DB_PATH = process.env.DB_PATH ?? defaultDbPath;

// Ensure parent directory exists (e.g. /data volume on Railway)
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

let _db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (_db) return _db;
  _db = new DatabaseSync(DB_PATH);
  _db.exec("PRAGMA journal_mode = WAL");
  _db.exec("PRAGMA foreign_keys = ON");
  initSchema(_db);
  return _db;
}

function initSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS manifests (
      id          TEXT PRIMARY KEY,
      zip_code    TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      total_packages INTEGER NOT NULL DEFAULT 0,
      status      TEXT NOT NULL DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS packages (
      id               TEXT PRIMARY KEY,
      manifest_id      TEXT NOT NULL,
      tracking_number  TEXT NOT NULL UNIQUE,
      recipient_name   TEXT NOT NULL,
      address          TEXT NOT NULL,
      city             TEXT NOT NULL,
      state            TEXT NOT NULL DEFAULT 'IN',
      zip              TEXT NOT NULL,
      lat              REAL NOT NULL,
      lng              REAL NOT NULL,
      package_count    INTEGER NOT NULL DEFAULT 1,
      service_type     TEXT NOT NULL DEFAULT 'Priority Mail',
      weight_oz        INTEGER NOT NULL DEFAULT 16,
      status           TEXT NOT NULL DEFAULT 'pending',
      is_ghost         INTEGER NOT NULL DEFAULT 0,
      created_at       TEXT NOT NULL,
      scanned_at       TEXT,
      delivered_at     TEXT,
      FOREIGN KEY (manifest_id) REFERENCES manifests(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS routes (
      id              TEXT PRIMARY KEY,
      manifest_id     TEXT NOT NULL,
      driver_name     TEXT NOT NULL DEFAULT 'Driver',
      vehicle_id      TEXT,
      status          TEXT NOT NULL DEFAULT 'loading',
      start_address   TEXT NOT NULL,
      start_lat       REAL,
      start_lng       REAL,
      cluster_meters  REAL NOT NULL DEFAULT 50,
      alert_meters    REAL NOT NULL DEFAULT 120,
      created_at      TEXT NOT NULL,
      optimized_at    TEXT,
      completed_at    TEXT,
      FOREIGN KEY (manifest_id) REFERENCES manifests(id)
    );

    CREATE TABLE IF NOT EXISTS route_stops (
      id                      TEXT PRIMARY KEY,
      route_id                TEXT NOT NULL,
      sequence_number         INTEGER NOT NULL,
      cluster_id              TEXT NOT NULL,
      centroid_lat            REAL NOT NULL,
      centroid_lng            REAL NOT NULL,
      drive_seconds_from_prev INTEGER NOT NULL DEFAULT 0,
      drive_miles_from_prev   REAL NOT NULL DEFAULT 0,
      alerts                  TEXT NOT NULL DEFAULT '[]',
      geometry                TEXT,
      status                  TEXT NOT NULL DEFAULT 'pending',
      arrived_at              TEXT,
      completed_at            TEXT,
      FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS route_stop_packages (
      route_stop_id TEXT NOT NULL,
      package_id    TEXT NOT NULL,
      PRIMARY KEY (route_stop_id, package_id),
      FOREIGN KEY (route_stop_id) REFERENCES route_stops(id) ON DELETE CASCADE,
      FOREIGN KEY (package_id)    REFERENCES packages(id)
    );

    CREATE TABLE IF NOT EXISTS gps_pings (
      id          TEXT PRIMARY KEY,
      route_id    TEXT NOT NULL,
      lat         REAL NOT NULL,
      lng         REAL NOT NULL,
      heading     REAL,
      speed_mph   REAL,
      recorded_at TEXT NOT NULL,
      FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_packages_manifest   ON packages(manifest_id);
    CREATE INDEX IF NOT EXISTS idx_packages_tracking   ON packages(tracking_number);
    CREATE INDEX IF NOT EXISTS idx_route_stops_route   ON route_stops(route_id, sequence_number);
    CREATE INDEX IF NOT EXISTS idx_gps_pings_route     ON gps_pings(route_id, recorded_at);
  `);
}
