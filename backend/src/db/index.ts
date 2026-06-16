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
      assigned_route_id TEXT,
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

  migrateSchema(db);
}

function migrateSchema(db: DatabaseSync): void {
  const manifestCols = queryColumnNames(db, "manifests");
  if (!manifestCols.has("source")) {
    db.exec(`ALTER TABLE manifests ADD COLUMN source TEXT NOT NULL DEFAULT 'synthetic'`);
  }
  if (!manifestCols.has("hub_id")) {
    db.exec(`ALTER TABLE manifests ADD COLUMN hub_id TEXT`);
  }
  if (!manifestCols.has("operation_date")) {
    db.exec(`ALTER TABLE manifests ADD COLUMN operation_date TEXT`);
  }
  if (!manifestCols.has("dut_time")) {
    db.exec(`ALTER TABLE manifests ADD COLUMN dut_time TEXT`);
  }
  if (!manifestCols.has("validation_summary")) {
    db.exec(`ALTER TABLE manifests ADD COLUMN validation_summary TEXT`);
  }

  const cols = queryColumnNames(db, "routes");
  if (!cols.has("return_drive_seconds")) {
    db.exec(`ALTER TABLE routes ADD COLUMN return_drive_seconds INTEGER NOT NULL DEFAULT 0`);
  }
  if (!cols.has("return_drive_miles")) {
    db.exec(`ALTER TABLE routes ADD COLUMN return_drive_miles REAL NOT NULL DEFAULT 0`);
  }
  if (!cols.has("route_number")) {
    db.exec(`ALTER TABLE routes ADD COLUMN route_number TEXT`);
  }
  if (!cols.has("begin_tour_at")) {
    db.exec(`ALTER TABLE routes ADD COLUMN begin_tour_at TEXT`);
  }
  if (!cols.has("loaded_at")) {
    db.exec(`ALTER TABLE routes ADD COLUMN loaded_at TEXT`);
  }
  if (!cols.has("departed_at")) {
    db.exec(`ALTER TABLE routes ADD COLUMN departed_at TEXT`);
  }
  if (!cols.has("sunday_mode")) {
    db.exec(`ALTER TABLE routes ADD COLUMN sunday_mode INTEGER NOT NULL DEFAULT 1`);
  }

  const packageCols = queryColumnNames(db, "packages");
  if (!packageCols.has("assigned_route_id")) {
    db.exec(`ALTER TABLE packages ADD COLUMN assigned_route_id TEXT`);
  }
  const pkgMigrations: Array<[string, string]> = [
    ["address_line_2", "TEXT"],
    ["validation_status", "TEXT NOT NULL DEFAULT 'verified'"],
    ["validation_reasons", "TEXT NOT NULL DEFAULT '[]'"],
    ["hazmat_flag", "INTEGER NOT NULL DEFAULT 0"],
    ["oversize_flag", "INTEGER NOT NULL DEFAULT 0"],
    ["sunday_eligible", "INTEGER NOT NULL DEFAULT 1"],
    ["length_in", "INTEGER NOT NULL DEFAULT 0"],
    ["width_in", "INTEGER NOT NULL DEFAULT 0"],
    ["height_in", "INTEGER NOT NULL DEFAULT 0"],
    ["pod_required", "INTEGER NOT NULL DEFAULT 0"],
    ["delivery_notes", "TEXT"],
    ["quarantine_status", "TEXT NOT NULL DEFAULT 'none'"],
    ["override_note", "TEXT"],
    ["override_by", "TEXT"],
    ["override_at", "TEXT"],
    ["promised_window_start", "TEXT"],
    ["promised_window_end", "TEXT"],
  ];
  for (const [name, def] of pkgMigrations) {
    if (!packageCols.has(name)) {
      db.exec(`ALTER TABLE packages ADD COLUMN ${name} ${def}`);
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_events (
      id          TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id   TEXT NOT NULL,
      action      TEXT NOT NULL,
      actor       TEXT,
      before_json TEXT,
      after_json  TEXT,
      reason      TEXT,
      created_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_events(entity_type, entity_id);
  `);
}

function queryColumnNames(db: DatabaseSync, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}
