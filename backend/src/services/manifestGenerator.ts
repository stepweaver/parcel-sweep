import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db/index.js";
import { queryOne, queryAll } from "../db/helpers.js";
import { ManifestRow, PackageRow } from "../types/index.js";

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "parcel-sweep-demo/1.0 (local dev)";

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

interface OsmAddress {
  address: string;
  city: string;
  lat: number;
  lng: number;
}

function parseOverpassElements(elements: OverpassElement[]): OsmAddress[] {
  const addresses: OsmAddress[] = [];

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

async function geocodeZip(zipCode: string): Promise<{ lat: number; lng: number; city: string }> {
  const response = await axios.get<Array<{ lat: string; lon: string; display_name: string }>>(
    NOMINATIM_URL,
    {
      params: { postalcode: zipCode, country: "US", format: "json", limit: 1 },
      headers: { "User-Agent": USER_AGENT },
      timeout: 15_000,
    }
  );

  const hit = response.data[0];
  if (!hit) {
    throw new Error(`Could not geocode ZIP ${zipCode}. Try a different US ZIP code.`);
  }

  const city = hit.display_name.split(",")[0]?.trim() || "Unknown";
  return { lat: parseFloat(hit.lat), lng: parseFloat(hit.lon), city };
}

async function runOverpassQuery(query: string): Promise<OverpassElement[]> {
  const body = new URLSearchParams({ data: query }).toString();
  let lastError: unknown;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await axios.post<OverpassResponse>(endpoint, body, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "*/*",
          "User-Agent": USER_AGENT,
        },
        timeout: 35_000,
        validateStatus: (status) => status < 500,
      });

      if (response.status >= 400) {
        throw new Error(`Overpass returned HTTP ${response.status}`);
      }

      return response.data.elements ?? [];
    } catch (err) {
      lastError = err;
      console.warn(`[manifest] Overpass query failed on ${endpoint}:`, err instanceof Error ? err.message : err);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("All Overpass endpoints failed. Try again in a moment.");
}

async function fetchOsmAddresses(zipCode: string, limit: number): Promise<OsmAddress[]> {
  const { lat, lng, city: defaultCity } = await geocodeZip(zipCode);
  const radiusMeters = 8_000;
  const outLimit = Math.min(limit * 4, 800);

  const aroundQuery = `[out:json][timeout:30];
(
  node["addr:housenumber"]["addr:street"](around:${radiusMeters},${lat},${lng});
  way["addr:housenumber"]["addr:street"](around:${radiusMeters},${lat},${lng});
);
out center ${outLimit};`;

  let addresses = parseOverpassElements(await runOverpassQuery(aroundQuery));

  if (addresses.length === 0) {
    const areaQuery = `[out:json][timeout:30];
area["postal_code"="${zipCode}"]["boundary"="postal_code"]->.a;
(
  node["addr:housenumber"]["addr:street"](area.a);
  way["addr:housenumber"]["addr:street"](area.a);
);
out center ${outLimit};`;

    addresses = parseOverpassElements(await runOverpassQuery(areaQuery));
  }

  if (addresses.length === 0) {
    console.warn(`[manifest] No OSM addresses for ZIP ${zipCode}; using demo fallback addresses.`);
    addresses = generateFallbackAddresses(defaultCity, lat, lng, limit);
  }

  return addresses;
}

function generateFallbackAddresses(
  city: string,
  centerLat: number,
  centerLng: number,
  count: number
): OsmAddress[] {
  const streets = [
    "Main St", "Oak Ave", "Maple Dr", "Cedar Ln", "Pine Rd",
    "Elm St", "Washington Ave", "Lincoln Way", "Jefferson Blvd", "Adams St",
  ];

  return Array.from({ length: Math.max(count, 20) }, (_, i) => ({
    address: `${100 + i * 7} ${streets[i % streets.length]}`,
    city,
    lat: centerLat + (Math.random() - 0.5) * 0.08,
    lng: centerLng + (Math.random() - 0.5) * 0.08,
  }));
}

export async function generateManifest(zipCode: string, count: number): Promise<string> {
  const osmAddresses = await fetchOsmAddresses(zipCode, count);
  if (osmAddresses.length === 0) {
    throw new Error(`No address data found for ZIP ${zipCode}. Try a different ZIP.`);
  }

  const shuffled = osmAddresses.sort(() => Math.random() - 0.5);
  const sampled = shuffled.slice(0, Math.min(count, shuffled.length));

  const db = getDb();
  const manifestId = uuidv4();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO manifests (id, zip_code, generated_at, total_packages, status, source, hub_id, operation_date, dut_time)
     VALUES (?, ?, ?, ?, 'active', 'synthetic', 'chippewa', ?, '09:30')`
  ).run(manifestId, zipCode, now, sampled.length, now.slice(0, 10));

  const insertPkg = db.prepare(`
    INSERT INTO packages
      (id, manifest_id, tracking_number, recipient_name, address, city, state, zip,
       lat, lng, package_count, service_type, weight_oz, validation_status, validation_reasons,
       quarantine_status, sunday_eligible, status, is_ghost, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'IN', ?, ?, ?, ?, ?, ?, 'verified', '[]', 'none', 1, 'pending', 0, ?)
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
