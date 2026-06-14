import L from "leaflet";

declare global {
  interface Window {
    L: typeof L;
  }
}

window.L = L;
await import("leaflet-rotate/dist/leaflet-rotate.js");

export default L;
