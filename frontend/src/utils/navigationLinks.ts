/** Deep links and URLs for external navigation apps. */

export interface NavTarget {
  lat: number;
  lng: number;
  label?: string;
  address?: string;
}

export function googleMapsStopUrl(target: NavTarget): string {
  const dest = target.lat && target.lng
    ? `${target.lat},${target.lng}`
    : encodeURIComponent(target.address ?? "");
  return `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`;
}

export function wazeStopUrl(target: NavTarget): string {
  return `https://waze.com/ul?ll=${target.lat},${target.lng}&navigate=yes`;
}

export function appleMapsStopUrl(target: NavTarget): string {
  const dest = target.lat && target.lng
    ? `${target.lat},${target.lng}`
    : encodeURIComponent(target.address ?? "");
  return `https://maps.apple.com/?daddr=${dest}&dirflg=d`;
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

export function openExternal(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}
