/** Deep links and URLs for external navigation apps. */

export interface NavTarget {
  lat: number;
  lng: number;
  label?: string;
  address?: string;
}

function hasCoords(target: NavTarget): boolean {
  return Number.isFinite(target.lat) && Number.isFinite(target.lng);
}

function coordDest(target: NavTarget): string {
  return `${target.lat},${target.lng}`;
}

export function googleMapsStopUrl(target: NavTarget): string {
  const params = new URLSearchParams({
    api: "1",
    travelmode: "driving",
  });
  if (hasCoords(target)) {
    params.set("destination", coordDest(target));
  } else if (target.address) {
    params.set("destination", target.address);
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function wazeStopUrl(target: NavTarget): string {
  const params = new URLSearchParams({ navigate: "yes" });
  if (hasCoords(target)) {
    params.set("ll", coordDest(target));
  } else if (target.address) {
    params.set("q", target.address);
  }
  return `https://waze.com/ul?${params.toString()}`;
}

/**
 * Apple unified Maps URLs (iOS 18.4+). Legacy ?daddr=lat,lng links no longer
 * open navigation reliably on recent iOS versions.
 */
export function appleMapsStopUrl(target: NavTarget): string {
  const params = new URLSearchParams({ mode: "driving" });
  if (hasCoords(target)) {
    params.set("destination", coordDest(target));
  } else if (target.address) {
    params.set("destination", target.address);
  }
  return `https://maps.apple.com/directions?${params.toString()}`;
}

/**
 * Google Maps multi-stop route: depot → all pending stops in sequence.
 * Limited to ~10 waypoints by Google; truncates if longer.
 */
export function googleMapsFullRouteUrl(
  start: NavTarget,
  stops: Array<{ lat: number; lng: number }>
): string {
  if (stops.length === 0) return googleMapsStopUrl(start);

  const origin = `${start.lat},${start.lng}`;
  const destination = `${stops[stops.length - 1].lat},${stops[stops.length - 1].lng}`;
  const middle = stops.slice(0, -1).slice(0, 9);
  const params = new URLSearchParams({
    api: "1",
    origin,
    destination,
    travelmode: "driving",
  });
  if (middle.length > 0) {
    params.set("waypoints", middle.map((s) => `${s.lat},${s.lng}`).join("|"));
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/** Open an external navigation URL (anchor click is more reliable than window.open on mobile). */
export function openExternal(url: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
}
