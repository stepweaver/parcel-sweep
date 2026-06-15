import { useEffect, useRef } from "react";
import L from "../lib/leafletWithRotate";
import type { RouteStopDetail } from "../api";
import { DEFAULT_MAP_THEME_ID, getMapTheme, type MapTheme, type MapThemeId } from "../utils/mapThemes";
import { filterFutureNearbyAlerts } from "../utils/nearbyAlerts";

function createTileLayer(theme: MapTheme): L.TileLayer {
  return L.tileLayer(theme.url, {
    maxZoom: theme.maxZoom,
    attribution: theme.attribution,
    ...(theme.subdomains ? { subdomains: theme.subdomains } : {}),
  });
}

const ROUTE_CORE = { color: "#0066ff", weight: 6, opacity: 1, lineCap: "round" as const, lineJoin: "round" as const };
const ROUTE_CASING = { color: "#ffffff", weight: 10, opacity: 0.95, lineCap: "round" as const, lineJoin: "round" as const };

function addRouteLine(layers: L.LayerGroup, coords: L.LatLngExpression[], dashed = false) {
  if (coords.length < 2) return;
  L.polyline(coords, ROUTE_CASING).addTo(layers);
  L.polyline(coords, { ...ROUTE_CORE, ...(dashed ? { dashArray: "8 6", opacity: 0.75, weight: 4 } : {}) }).addTo(layers);
}

const DRIVER_MARKER_SRC = "/usps-eagle.svg";
const DRIVER_PIN_W = 36;
const DRIVER_PIN_H = 42; // taller than wide — teardrop shape

/**
 * Directional teardrop pin — arrow inside points forward.
 * In follow mode the map rotates so heading=0; in overview mode rotate the pin by heading.
 */
function driverMarkerIcon(followDriver: boolean, heading: number | null): L.DivIcon {
  const deg = followDriver ? 0 : (heading ?? 0);
  return L.divIcon({
    className: "",
    html: `<div style="transform:rotate(${deg}deg);transform-origin:${DRIVER_PIN_W / 2}px ${DRIVER_PIN_H / 2}px;">
      <img src="${DRIVER_MARKER_SRC}" width="${DRIVER_PIN_W}" height="${DRIVER_PIN_H}" alt=""
        draggable="false" decoding="async"
        style="display:block;user-select:none;pointer-events:none;"/>
    </div>`,
    iconSize: [DRIVER_PIN_W, DRIVER_PIN_H],
    iconAnchor: [DRIVER_PIN_W / 2, DRIVER_PIN_H / 2],
  });
}

// Fix Leaflet default icon paths broken by bundlers
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

interface DeliveryMapProps {
  stops: RouteStopDetail[];
  driverPosition?: { lat: number; lng: number } | null;
  /** Compass heading in degrees (0 = north). Rotates the map in follow mode. */
  driverHeading?: number | null;
  activeStopId?: string | null;
  clusterMeters?: number;
  /** When true, the map follows the driver instead of fitting all stops. */
  followDriver?: boolean;
  mapThemeId?: MapThemeId;
  style?: React.CSSProperties;
}

function stopColor(stop: RouteStopDetail): string {
  if (stop.status === "complete") return "#6b7280";
  if (stop.status === "arrived") return "#f59e0b";
  return "#004b87";
}

const PULSE_STYLE = `
@keyframes stopPulse {
  0%   { box-shadow: 0 0 0 0 rgba(218,41,28,.7); }
  70%  { box-shadow: 0 0 0 14px rgba(218,41,28,0); }
  100% { box-shadow: 0 0 0 0 rgba(218,41,28,0); }
}
@keyframes driverPulse {
  0%   { box-shadow: 0 0 0 0 rgba(0,75,135,.7); }
  70%  { box-shadow: 0 0 0 16px rgba(0,75,135,0); }
  100% { box-shadow: 0 0 0 0 rgba(0,75,135,0); }
}`;

export function DeliveryMap({
  stops,
  driverPosition,
  driverHeading,
  activeStopId,
  clusterMeters = 50,
  followDriver = false,
  mapThemeId = DEFAULT_MAP_THEME_ID,
  style,
}: DeliveryMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const layersRef = useRef<L.LayerGroup | null>(null);
  const driverMarkerRef = useRef<L.Marker | null>(null);
  const followingRef = useRef(followDriver);
  const lastHeadingRef = useRef<number | null>(null);
  followingRef.current = followDriver;

  // Initialise map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: !followDriver,
      attributionControl: true,
      dragging: !followDriver,
      scrollWheelZoom: !followDriver,
      rotate: followDriver,
      touchRotate: false,
      rotateControl: false,
      bearing: 0,
    });
    const initialTheme = getMapTheme(mapThemeId);
    tileLayerRef.current = createTileLayer(initialTheme).addTo(map);
    map.setView([41.6764, -86.252], followDriver ? 16 : 12);
    mapRef.current = map;
    layersRef.current = L.layerGroup().addTo(map);
    return () => {
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Swap basemap when theme changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const theme = getMapTheme(mapThemeId);
    tileLayerRef.current?.remove();
    tileLayerRef.current = createTileLayer(theme).addTo(map);
  }, [mapThemeId]);

  // Redraw stop markers + route polyline whenever stops change
  useEffect(() => {
    const map = mapRef.current;
    const layers = layersRef.current;
    if (!map || !layers) return;
    layers.clearLayers();
    if (stops.length === 0) return;

    // In follow-driver mode, only draw the route line to the next pending stop
    const activeStop = stops.find((s) => s.id === activeStopId);

    if (followDriver && activeStop?.geometry) {
      const coords: L.LatLngExpression[] = activeStop.geometry.map(([lng, lat]) => [lat, lng]);
      addRouteLine(layers, coords);
    } else if (!followDriver) {
      const allCoords: L.LatLngExpression[] = [];
      for (const stop of stops) {
        if (stop.geometry) {
          for (const [lng, lat] of stop.geometry) allCoords.push([lat, lng]);
        }
      }
      addRouteLine(layers, allCoords, true);
    }

    // Markers
    for (const stop of stops) {
      const { lat, lng } = stop.centroid;
      const isActive = stop.id === activeStopId;
      const color = isActive ? "#da291c" : stopColor(stop);
      const size = isActive ? 40 : (followDriver ? 24 : 28);

      if (!followDriver) {
        L.circle([lat, lng], {
          radius: clusterMeters,
          color,
          weight: isActive ? 2 : 1,
          fillColor: color,
          fillOpacity: 0.07,
        }).addTo(layers);
      }

      const icon = L.divIcon({
        className: "",
        html: `<div style="
          background:${color};color:#fff;border-radius:50%;
          width:${size}px;height:${size}px;
          display:flex;align-items:center;justify-content:center;
          font-weight:800;font-size:${isActive ? 16 : 12}px;
          border:2.5px solid #fff;
          box-shadow:0 2px 6px rgba(0,0,0,.4);
          ${isActive ? "animation:stopPulse 1.4s ease-out infinite;" : ""}
        ">${stop.sequenceNumber}</div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });

      const visibleAlerts = filterFutureNearbyAlerts(stop.alerts, stop.sequenceNumber, stops);
      const popupLines = [
        `<b>Stop #${stop.sequenceNumber}</b>`,
        ...stop.packages.map((p) => `${p.address} — ${p.recipientName}`),
        visibleAlerts.length ? `<span style="color:#d97706">⚠ ${visibleAlerts[0]}</span>` : "",
      ].filter(Boolean).join("<br>");

      L.marker([lat, lng], { icon }).bindPopup(popupLines).addTo(layers);
    }

    if (!followDriver) {
      const bounds = L.latLngBounds(stops.map((s) => [s.centroid.lat, s.centroid.lng]));
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [stops, activeStopId, clusterMeters, followDriver]);

  // Driver marker + POV camera (marker stays on the route at true lat/lng)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (driverPosition) {
      const latlng: L.LatLngExpression = [driverPosition.lat, driverPosition.lng];

      if (driverHeading != null && Number.isFinite(driverHeading)) {
        lastHeadingRef.current = driverHeading;
      }

      const heading = lastHeadingRef.current;
      const icon = driverMarkerIcon(followDriver, heading);
      if (!driverMarkerRef.current) {
        driverMarkerRef.current = L.marker(latlng, { icon, zIndexOffset: 1000 }).addTo(map);
      } else {
        driverMarkerRef.current.setLatLng(latlng);
        driverMarkerRef.current.setIcon(icon);
      }

      if (followingRef.current) {
        const heading = lastHeadingRef.current;
        const zoom = Math.max(map.getZoom(), 16);
        if (heading != null) {
          map.setBearing(-heading);
        }
        map.setView(latlng, zoom, { animate: false });
        const offsetY = (containerRef.current?.clientHeight ?? 0) / 5;
        if (offsetY > 0) {
          map.panBy([0, -offsetY], { animate: false });
        }
      }
    } else {
      driverMarkerRef.current?.remove();
      driverMarkerRef.current = null;
    }
  }, [driverPosition, driverHeading, followDriver]);

  return (
    <>
      <style>{PULSE_STYLE}</style>
      <div
        ref={containerRef}
        style={{ width: "100%", height: "100%", borderRadius: 0, ...style }}
      />
    </>
  );
}
