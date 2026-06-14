import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet-rotate";
import type { RouteStopDetail } from "../api";

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
  0%   { box-shadow: 0 0 0 0 rgba(22,163,74,.7); }
  70%  { box-shadow: 0 0 0 16px rgba(22,163,74,0); }
  100% { box-shadow: 0 0 0 0 rgba(22,163,74,0); }
}`;

export function DeliveryMap({
  stops,
  driverPosition,
  driverHeading,
  activeStopId,
  clusterMeters = 50,
  followDriver = false,
  style,
}: DeliveryMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
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
      attributionControl: false,
      dragging: !followDriver,
      scrollWheelZoom: !followDriver,
      rotate: followDriver,
      touchRotate: false,
      rotateControl: false,
      bearing: 0,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
    }).addTo(map);
    map.setView([41.6764, -86.252], followDriver ? 16 : 12);
    mapRef.current = map;
    layersRef.current = L.layerGroup().addTo(map);
    return () => { map.remove(); mapRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      // Route line: just the leg to the next stop
      const coords: L.LatLngExpression[] = activeStop.geometry.map(([lng, lat]) => [lat, lng]);
      if (coords.length > 1) {
        L.polyline(coords, { color: "#da291c", weight: 4, opacity: 0.7 }).addTo(layers);
      }
    } else if (!followDriver) {
      // Full route polyline
      const allCoords: L.LatLngExpression[] = [];
      for (const stop of stops) {
        if (stop.geometry) {
          for (const [lng, lat] of stop.geometry) allCoords.push([lat, lng]);
        }
      }
      if (allCoords.length > 1) {
        L.polyline(allCoords, { color: "#004b87", weight: 3, opacity: 0.55, dashArray: "6 4" }).addTo(layers);
      }
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

      const popupLines = [
        `<b>Stop #${stop.sequenceNumber}</b>`,
        ...stop.packages.map((p) => `${p.address} — ${p.recipientName}`),
        stop.alerts.length ? `<span style="color:#d97706">⚠ ${stop.alerts[0]}</span>` : "",
      ].filter(Boolean).join("<br>");

      L.marker([lat, lng], { icon }).bindPopup(popupLines).addTo(layers);
    }

    if (!followDriver) {
      const bounds = L.latLngBounds(stops.map((s) => [s.centroid.lat, s.centroid.lng]));
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [stops, activeStopId, clusterMeters, followDriver]);

  // POV follow: rotate map to heading, center on driver, offset view forward
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (driverPosition) {
      const latlng: L.LatLngExpression = [driverPosition.lat, driverPosition.lng];

      if (driverHeading != null && Number.isFinite(driverHeading)) {
        lastHeadingRef.current = driverHeading;
      }

      if (followingRef.current) {
        const heading = lastHeadingRef.current;
        if (heading != null) {
          map.setBearing(-heading);
        }
        map.setView(latlng, Math.max(map.getZoom(), 16), { animate: true, duration: 0.8 });
        const offsetY = (containerRef.current?.clientHeight ?? 0) / 5;
        if (offsetY > 0) {
          map.panBy([0, -offsetY], { animate: false });
        }
      } else if (!driverMarkerRef.current) {
        const icon = L.divIcon({
          className: "",
          html: `<div style="
            background:#16a34a;width:20px;height:20px;border-radius:50%;
            border:3px solid #fff;
            box-shadow:0 2px 8px rgba(0,0,0,.4);
            animation:driverPulse 1.6s ease-out infinite;
          "></div>`,
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        });
        driverMarkerRef.current = L.marker(latlng, { icon, zIndexOffset: 1000 }).addTo(map);
      } else {
        driverMarkerRef.current.setLatLng(latlng);
      }
    } else {
      driverMarkerRef.current?.remove();
      driverMarkerRef.current = null;
    }
  }, [driverPosition, driverHeading, followDriver]);

  const showPovIndicator = followDriver && driverPosition;

  return (
    <>
      <style>{PULSE_STYLE}</style>
      <div style={{ position: "relative", width: "100%", height: "100%", ...style }}>
        <div
          ref={containerRef}
          style={{ width: "100%", height: "100%", borderRadius: 0 }}
        />
        {showPovIndicator && (
          <div
            aria-hidden
            style={{
              position: "absolute",
              left: "50%",
              top: "70%",
              transform: "translate(-50%, -50%)",
              pointerEvents: "none",
              zIndex: 1000,
            }}
          >
            <div style={{
              width: 0,
              height: 0,
              margin: "0 auto",
              borderLeft: "11px solid transparent",
              borderRight: "11px solid transparent",
              borderBottom: "24px solid #16a34a",
              filter: "drop-shadow(0 2px 4px rgba(0,0,0,.5))",
            }} />
            <div style={{
              width: 14,
              height: 14,
              margin: "-4px auto 0",
              borderRadius: "50%",
              background: "#fff",
              border: "3px solid #16a34a",
              boxShadow: "0 2px 6px rgba(0,0,0,.35)",
            }} />
          </div>
        )}
      </div>
    </>
  );
}
