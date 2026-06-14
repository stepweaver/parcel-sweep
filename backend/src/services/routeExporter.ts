import { RouteDetail, RouteStopDetail } from "../types/index.js";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function stopLabel(stop: RouteStopDetail): string {
  const addr = stop.packages[0]?.address ?? "Unknown";
  return `Stop ${stop.sequenceNumber}: ${addr}`;
}

function stopDescription(stop: RouteStopDetail): string {
  const lines = stop.packages.map(
    (p) => `${p.trackingNumber} — ${p.recipientName} (${p.address})`
  );
  if (stop.alerts.length) lines.push(`Alerts: ${stop.alerts.join("; ")}`);
  return lines.join("\n");
}

/** GPX 1.1 with waypoints in delivery sequence and optional track geometry. */
export function buildGpx(route: RouteDetail): string {
  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<gpx version="1.1" creator="Parcel Sweep" xmlns="http://www.topografix.com/GPX/1/1">`,
    `  <metadata>`,
    `    <name>${escapeXml(route.driverName)} — Route ${route.id.slice(0, 8)}</name>`,
    `    <desc>Delivery route from ${escapeXml(route.startAddress)}</desc>`,
    `  </metadata>`,
  ];

  if (route.startLat != null && route.startLng != null) {
    lines.push(
      `  <wpt lat="${route.startLat}" lon="${route.startLng}">`,
      `    <name>Depot</name>`,
      `    <desc>${escapeXml(route.startAddress)}</desc>`,
      `  </wpt>`
    );
  }

  for (const stop of route.stops) {
    lines.push(
      `  <wpt lat="${stop.centroid.lat}" lon="${stop.centroid.lng}">`,
      `    <name>${escapeXml(stopLabel(stop))}</name>`,
      `    <desc>${escapeXml(stopDescription(stop))}</desc>`,
      `  </wpt>`
    );
  }

  const trackPoints: string[] = [];
  for (const stop of route.stops) {
    if (!stop.geometry) continue;
    for (const [lng, lat] of stop.geometry) {
      trackPoints.push(`      <trkpt lat="${lat}" lon="${lng}"></trkpt>`);
    }
  }

  if (trackPoints.length > 0) {
    lines.push(`  <trk>`, `    <name>Route path</name>`, `    <trkseg>`);
    lines.push(...trackPoints);
    lines.push(`    </trkseg>`, `  </trk>`);
  }

  lines.push(`</gpx>`);
  return lines.join("\n");
}

/** KML 2.2 with numbered placemarks and route line. */
export function buildKml(route: RouteDetail): string {
  const placemarks: string[] = [];

  if (route.startLat != null && route.startLng != null) {
    placemarks.push(`
    <Placemark>
      <name>Depot</name>
      <description>${escapeXml(route.startAddress)}</description>
      <Point><coordinates>${route.startLng},${route.startLat},0</coordinates></Point>
    </Placemark>`);
  }

  for (const stop of route.stops) {
    placemarks.push(`
    <Placemark>
      <name>${escapeXml(stopLabel(stop))}</name>
      <description>${escapeXml(stopDescription(stop))}</description>
      <Point><coordinates>${stop.centroid.lng},${stop.centroid.lat},0</coordinates></Point>
    </Placemark>`);
  }

  const routeCoords: string[] = [];
  for (const stop of route.stops) {
    if (!stop.geometry) continue;
    for (const [lng, lat] of stop.geometry) {
      routeCoords.push(`${lng},${lat},0`);
    }
  }

  let routeLine = "";
  if (routeCoords.length > 1) {
    routeLine = `
    <Placemark>
      <name>Route path</name>
      <LineString>
        <tessellate>1</tessellate>
        <coordinates>${routeCoords.join(" ")}</coordinates>
      </LineString>
    </Placemark>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(route.driverName)} — Delivery Route</name>
    <description>${route.stops.length} stops from ${escapeXml(route.startAddress)}</description>
    ${placemarks.join("")}
    ${routeLine}
  </Document>
</kml>`;
}

function csvEscape(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** CSV for Garmin / fleet GPS import. One row per package. */
export function buildCsv(route: RouteDetail): string {
  const header =
    "delivery_sequence,load_position,address,city,state,zip,lat,lng,recipient,tracking_number,package_count,status";
  const rows: string[] = [header];
  const totalStops = route.stops.length;

  for (const stop of route.stops) {
    const loadPosition = totalStops - stop.sequenceNumber + 1;
    for (const pkg of stop.packages) {
      rows.push(
        [
          stop.sequenceNumber,
          loadPosition,
          csvEscape(pkg.address),
          csvEscape(pkg.city),
          csvEscape(pkg.state),
          csvEscape(pkg.zip),
          pkg.lat,
          pkg.lng,
          csvEscape(pkg.recipientName),
          csvEscape(pkg.trackingNumber),
          pkg.packageCount,
          stop.status,
        ].join(",")
      );
    }
  }

  return rows.join("\n");
}
