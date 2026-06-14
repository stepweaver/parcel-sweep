import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db/index.js";
import { queryOne, queryAll } from "../db/helpers.js";
import { ManifestRow, PackageRow } from "../types/index.js";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

const FIRST_NAMES = [
  "James","Mary","John","Patricia","Robert","Jennifer","Michael","Linda",
  "William","Barbara","David","Elizabeth","Richard","Susan","Joseph","Jessica",
  "Thomas","Sarah","Charles","Karen","Christopher","Lisa","Daniel","Nancy",
  "Matthew","Betty","Anthony","Margaret","Mark","Sandra","Donald","Ashley",
  "Steven","Dorothy","Paul","Kimberly","Andrew","Emily","Kenneth","Donna",
];
const LAST_NAMES = [
  "Smith","Johnson","Williams","Brown","Jones","Garcia","Miller","Davis",
  "Rodriguez","Martinez","Hernandez","Lopez","Gonzalez","Wilson","Anderson",
  "Thomas","Taylor","Moore","Jackson","Martin","Lee","Perez","Thompson",
  "White","Harris","Sanchez","Clark","Ramirez","Lewis","Robinson","Walker",
  "Young","Allen","King","Wright","Scott","Torres","Nguyen","Hill","Flores",
];
const SERVICE_TYPES = [
  "Priority Mail","Priority Mail",
  "First-Class Package","First-Class Package",
  "USPS Retail Ground","Media Mail",
];

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateTrackingNumber(zip: string): string {
  const base = "9400" + String(randomInt(100000000, 999999999)) + String(randomInt(10000000, 99999999)) + zip.padEnd(9, "0").slice(0, 9);
  return base.slice(0, 22);
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

async function fetchOsmAddresses(
  zipCode: string,
  limit: number
): Promise<Array<{ address: string; city: string; lat: number; lng: number }>> {
  const query = `[out:json][timeout:30];
area["postal_code"="${zipCode}"]->.a;
(
  node["addr:housenumber"]["addr:street"](area.a);
  way["addr:housenumber"]["addr:street"](area.a);
);
out center ${Math.min(limit * 4, 800)};`;

  const response = await axios.post<OverpassResponse>(
    OVERPASS_URL,
    `data=${encodeURIComponent(query)}`,
    { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 35_000 }
  );

  const elements = response.data.elements ?? [];
  const addresses: Array<{ address: string; city: string; lat: number; lng: number }> = [];

  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (!lat || !lon || !el.tags) continue;
    const houseNumber = el.tags["addr:housenumber"];
    const street = el.tags["addr:street"];
    const city = el.tags["addr:city"] ?? el.tags["addr:suburb"] ?? "South Bend";
    if (houseNumber && street) {
      addresses.push({ address: `${houseNumber} ${street}`, city, lat, lng: lon });
    }
  }
  return addresses;
}

export async function generateManifest(zipCode: string, count: number): Promise<string> {
  const osmAddresses = await fetchOsmAddresses(zipCode, count);
  if (osmAddresses.length === 0) {
    throw new Error(`No OSM address data found for ZIP ${zipCode}. Try a different ZIP or check Overpass API.`);
  }

  const shuffled = osmAddresses.sort(() => Math.random() - 0.5);
  const sampled = shuffled.slice(0, Math.min(count, shuffled.length));

  const db = getDb();
  const manifestId = uuidv4();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO manifests (id, zip_code, generated_at, total_packages, status) VALUES (?, ?, ?, ?, 'active')`
  ).run(manifestId, zipCode, now, sampled.length);

  const insertPkg = db.prepare(`
    INSERT INTO packages
      (id, manifest_id, tracking_number, recipient_name, address, city, state, zip,
       lat, lng, package_count, service_type, weight_oz, status, is_ghost, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'IN', ?, ?, ?, ?, ?, ?, 'pending', 0, ?)
  `);

  for (const addr of sampled) {
    insertPkg.run(
      uuidv4(), manifestId, generateTrackingNumber(zipCode),
      `${randomItem(FIRST_NAMES)} ${randomItem(LAST_NAMES)}`,
      addr.address, addr.city, zipCode,
      addr.lat, addr.lng, randomInt(1, 3),
      randomItem(SERVICE_TYPES), randomInt(4, 320), now
    );
  }

  db.prepare(`UPDATE manifests SET total_packages = ? WHERE id = ?`).run(sampled.length, manifestId);
  return manifestId;
}

export function getManifestWithPackages(manifestId: string): (ManifestRow & { packages: PackageRow[] }) | null {
  const db = getDb();
  const manifest = queryOne<ManifestRow>(db.prepare(`SELECT * FROM manifests WHERE id = ?`), manifestId);
  if (!manifest) return null;
  const packages = queryAll<PackageRow>(
    db.prepare(`SELECT * FROM packages WHERE manifest_id = ? ORDER BY address ASC`), manifestId
  );
  return { ...manifest, packages };
}
