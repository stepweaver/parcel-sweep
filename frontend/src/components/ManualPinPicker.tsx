import { useEffect, useRef, useState } from "react";
import L from "../lib/leafletWithRotate";
import { DEFAULT_MAP_THEME_ID, getMapTheme } from "../utils/mapThemes";

interface ManualPinPickerProps {
  addressLabel: string;
  center: { lat: number; lng: number; zoom: number };
  initialPin?: { lat: number; lng: number };
  onCancel: () => void;
  onConfirm: (lat: number, lng: number) => void;
}

export function ManualPinPicker({
  addressLabel,
  center,
  initialPin,
  onCancel,
  onConfirm,
}: ManualPinPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const initialPinRef = useRef(initialPin);
  const [pending, setPending] = useState<{ lat: number; lng: number } | undefined>(initialPin);

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
    map.setView([center.lat, center.lng], center.zoom);
    mapRef.current = map;
    const startPin = initialPinRef.current;

    const placeMarker = (lat: number, lng: number) => {
      if (markerRef.current) {
        markerRef.current.setLatLng([lat, lng]);
        return;
      }
      const marker = L.marker([lat, lng], { draggable: true });
      marker.on("dragend", () => {
        const pos = marker.getLatLng();
        setPending({ lat: pos.lat, lng: pos.lng });
      });
      marker.addTo(map);
      markerRef.current = marker;
    };

    if (startPin) placeMarker(startPin.lat, startPin.lng);

    map.on("click", (e: L.LeafletMouseEvent) => {
      placeMarker(e.latlng.lat, e.latlng.lng);
      setPending({ lat: e.latlng.lat, lng: e.latlng.lng });
    });

    requestAnimationFrame(() => {
      map.invalidateSize();
    });

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, [center.lat, center.lng, center.zoom]);

  const canConfirm = pending !== undefined;

  return (
    <div className="manual-pin-overlay" role="dialog" aria-modal="true" aria-labelledby="manual-pin-title">
      <div className="manual-pin-dialog">
        <div className="manual-pin-copy">
          <div id="manual-pin-title" className="manual-pin-title">
            Pin this stop
          </div>
          <div className="manual-pin-address">{addressLabel}</div>
          <div className="manual-pin-hint">
            Tap the house on the map. You can drag the pin to adjust it.
          </div>
        </div>
        <div ref={containerRef} className="manual-pin-map" />
        <div className="manual-pin-actions">
          <button
            type="button"
            className="btn-primary"
            disabled={!canConfirm}
            onClick={() => {
              if (!pending) return;
              onConfirm(pending.lat, pending.lng);
            }}
          >
            Use this pin
          </button>
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
