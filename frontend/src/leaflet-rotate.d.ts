import "leaflet";

declare module "leaflet" {
  interface MapOptions {
    rotate?: boolean;
    bearing?: number;
    rotateControl?: boolean | { closeOnZeroBearing?: boolean; position?: ControlPosition };
    touchRotate?: boolean;
    compassBearing?: boolean;
    shiftKeyRotate?: boolean;
  }

  interface Map {
    setBearing(bearing: number): this;
    getBearing(): number;
  }
}
