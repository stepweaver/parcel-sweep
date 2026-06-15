import L from "./leafletWithRotate";
import truckIconUrl from "../assets/parcel-sweep-postal-truck-icon.svg";
import truckPinUrl from "../assets/parcel-sweep-postal-truck-pin.svg";

export const POSTAL_TRUCK_PIN_WIDTH = 42;
export const POSTAL_TRUCK_PIN_HEIGHT = 52;
export const POSTAL_TRUCK_ICON_SIZE = 40;

export const postalTruckPinUrl = truckPinUrl;
export const postalTruckIconUrl = truckIconUrl;

export const postalTruckPinIcon = L.icon({
  iconUrl: truckPinUrl,
  iconSize: [POSTAL_TRUCK_PIN_WIDTH, POSTAL_TRUCK_PIN_HEIGHT],
  iconAnchor: [POSTAL_TRUCK_PIN_WIDTH / 2, POSTAL_TRUCK_PIN_HEIGHT],
  popupAnchor: [0, -48],
});

export const postalTruckIcon = L.icon({
  iconUrl: truckIconUrl,
  iconSize: [POSTAL_TRUCK_ICON_SIZE, POSTAL_TRUCK_ICON_SIZE],
  iconAnchor: [POSTAL_TRUCK_ICON_SIZE / 2, POSTAL_TRUCK_ICON_SIZE / 2],
  popupAnchor: [0, -POSTAL_TRUCK_ICON_SIZE / 2],
});

/** Rotating driver pin — anchor at the map tip, arrow/truck points forward. */
export function driverMarkerIcon(followDriver: boolean, heading: number | null): L.DivIcon {
  const deg = followDriver ? 0 : (heading ?? 0);
  const w = POSTAL_TRUCK_PIN_WIDTH;
  const h = POSTAL_TRUCK_PIN_HEIGHT;
  return L.divIcon({
    className: "",
    html: `<div style="transform:rotate(${deg}deg);transform-origin:${w / 2}px ${h}px;">
      <img src="${truckPinUrl}" width="${w}" height="${h}" alt=""
        draggable="false" decoding="async"
        style="display:block;user-select:none;pointer-events:none;"/>
    </div>`,
    iconSize: [w, h],
    iconAnchor: [w / 2, h],
  });
}
