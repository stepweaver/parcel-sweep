import { useEffect, useRef } from "react";
import L from "../lib/leafletWithRotate";
import type { RouteProposal, RouteProposalStop } from "../api";
import { DEFAULT_MAP_THEME_ID, getMapTheme } from "../utils/mapThemes";

const ROUTE_CORE = { color: "#0066ff", weight: 5, opacity: 1, lineCap: "round" as const, lineJoin: "round" as const };
const ROUTE_CASING = { color: "#ffffff", weight: 8, opacity: 0.95, lineCap: "round" as const, lineJoin: "round" as const };
const RETURN_STYLE = { color: "#6b7280", weight: 3, opacity: 0.7, dashArray: "6 6" as const };

interface ProposalRouteMapProps {
  depot: { lat: number; lng: number; address: string };
  proposal: RouteProposal;
  clusterMeters?: number;
  height?: number;
}

function addRouteLine(
  layers: L.LayerGroup,
  coords: L.LatLngExpression[],
  dashed = false
) {
  if (coords.length < 2) return;
  L.polyline(coords, ROUTE_CASING).addTo(layers);
  L.polyline(coords, dashed ? { ...RETURN_STYLE } : ROUTE_CORE).addTo(layers);
}

function buildRouteCoords(
  depot: { lat: number; lng: number },
  stops: RouteProposalStop[],
  returnGeometry: [number, number][] | null
): { outbound: L.LatLngExpression[]; returnLeg: L.LatLngExpression[] } {
  const outbound: L.LatLngExpression[] = [[depot.lat, depot.lng]];

  for (const stop of stops) {
    if (stop.geometry && stop.geometry.length > 0) {
      for (const [lng, lat] of stop.geometry) {
        outbound.push([lat, lng]);
      }
    } else {
      outbound.push([stop.centroid.lat, stop.centroid.lng]);
    }
  }

  const returnLeg: L.LatLngExpression[] = [];
  const lastStop = stops[stops.length - 1];
  if (lastStop) {
    if (returnGeometry && returnGeometry.length > 0) {
      for (const [lng, lat] of returnGeometry) {
        returnLeg.push([lat, lng]);
      }
    } else {
      returnLeg.push([lastStop.centroid.lat, lastStop.centroid.lng], [depot.lat, depot.lng]);
    }
  }

  return { outbound, returnLeg };
}

export function ProposalRouteMap({
  depot,
  proposal,
  clusterMeters = 50,
  height = 220,
}: ProposalRouteMapProps) {
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
    if (proposal.stops.length === 0) return;

    const { outbound, returnLeg } = buildRouteCoords(
      depot,
      proposal.stops,
      proposal.returnGeometry ?? null
    );

    addRouteLine(layers, outbound);
    addRouteLine(layers, returnLeg, true);

    L.marker([depot.lat, depot.lng], {
      icon: L.divIcon({
        className: "",
        html: `<div style="
          background:#004b87;color:#fff;border-radius:4px;
          padding:2px 6px;font-size:10px;font-weight:800;
          border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);
          white-space:nowrap;
        ">DEPOT</div>`,
        iconAnchor: [24, 12],
      }),
    })
      .bindPopup(`<b>Depot</b><br>${depot.address}`)
      .addTo(layers);

    for (const stop of proposal.stops) {
      const { lat, lng } = stop.centroid;
      L.circle([lat, lng], {
        radius: clusterMeters,
        color: "#004b87",
        weight: 1,
        fillColor: "#004b87",
        fillOpacity: 0.06,
      }).addTo(layers);

      L.marker([lat, lng], {
        icon: L.divIcon({
          className: "",
          html: `<div style="
            background:#004b87;color:#fff;border-radius:50%;
            width:26px;height:26px;display:flex;align-items:center;justify-content:center;
            font-weight:800;font-size:11px;border:2px solid #fff;
            box-shadow:0 2px 5px rgba(0,0,0,.35);
          ">${stop.sequenceNumber}</div>`,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        }),
      })
        .bindPopup(
          `<b>Stop #${stop.sequenceNumber}</b><br>${stop.packageIds.length} packages`
        )
        .addTo(layers);
    }

    const bounds = L.latLngBounds([
      [depot.lat, depot.lng],
      ...proposal.stops.map((s) => [s.centroid.lat, s.centroid.lng] as L.LatLngTuple),
    ]);
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [28, 28] });
    }
  }, [depot, proposal, clusterMeters]);

  return (
    <div
      ref={containerRef}
      className="proposal-route-map"
      style={{ width: "100%", height }}
    />
  );
}
