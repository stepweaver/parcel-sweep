import { useEffect, useRef } from "react";
import L from "../lib/leafletWithRotate";
import type { QuickRouteResponse } from "../api";
import { DEFAULT_MAP_THEME_ID, getMapTheme } from "../utils/mapThemes";

const ROUTE_CORE = {
  color: "#0066ff",
  weight: 5,
  opacity: 1,
  lineCap: "round" as const,
  lineJoin: "round" as const,
};
const ROUTE_CASING = {
  color: "#ffffff",
  weight: 8,
  opacity: 0.95,
  lineCap: "round" as const,
  lineJoin: "round" as const,
};

interface QuickRouteMapProps {
  result: QuickRouteResponse;
  height?: number;
}

export function QuickRouteMap({ result, height = 320 }: QuickRouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: true,
    });
    const theme = getMapTheme(DEFAULT_MAP_THEME_ID);
    L.tileLayer(theme.url, {
      maxZoom: theme.maxZoom,
      attribution: theme.attribution,
      ...(theme.subdomains ? { subdomains: theme.subdomains } : {}),
    }).addTo(map);
    mapRef.current = map;
    layersRef.current = L.layerGroup().addTo(map);
    return () => {
      map.remove();
      mapRef.current = null;
      layersRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layers = layersRef.current;
    if (!map || !layers) return;

    layers.clearLayers();
    if (result.route.length === 0) return;

    const { start, route } = result;

    // Build polyline: depot → each stop centroid → back to depot
    const coords: L.LatLngExpression[] = [[start.lat, start.lng]];
    for (const step of route) {
      coords.push([step.centroid.lat, step.centroid.lng]);
    }
    coords.push([start.lat, start.lng]);

    if (coords.length >= 2) {
      L.polyline(coords, ROUTE_CASING).addTo(layers);
      L.polyline(coords, ROUTE_CORE).addTo(layers);
    }

    // Depot marker
    L.marker([start.lat, start.lng], {
      icon: L.divIcon({
        className: "",
        html: `<div style="
          background:#004b87;color:#fff;border-radius:4px;
          padding:2px 7px;font-size:10px;font-weight:800;
          border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);
          white-space:nowrap;
        ">START</div>`,
        iconAnchor: [28, 12],
      }),
    })
      .bindPopup(`<b>Start</b><br>${start.address}`)
      .addTo(layers);

    // Stop markers
    for (const step of route) {
      const { lat, lng } = step.centroid;
      const addressLines = step.stops.map((s) => s.address).join("<br>");
      L.marker([lat, lng], {
        icon: L.divIcon({
          className: "",
          html: `<div style="
            background:#004b87;color:#fff;border-radius:50%;
            width:28px;height:28px;display:flex;align-items:center;justify-content:center;
            font-weight:800;font-size:11px;border:2px solid #fff;
            box-shadow:0 2px 5px rgba(0,0,0,.35);
          ">${step.sequence}</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        }),
      })
        .bindPopup(`<b>Stop #${step.sequence}</b><br>${addressLines}`)
        .addTo(layers);
    }

    const allPoints: L.LatLngTuple[] = [
      [start.lat, start.lng],
      ...route.map((s) => [s.centroid.lat, s.centroid.lng] as L.LatLngTuple),
    ];
    const bounds = L.latLngBounds(allPoints);
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [32, 32] });
    }
  }, [result]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height, borderRadius: "8px", overflow: "hidden" }}
    />
  );
}
