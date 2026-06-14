import { io, Socket } from "socket.io-client";

let _socket: Socket | null = null;

export function getSocket(): Socket {
  if (!_socket) {
    _socket = io({ path: "/socket.io", transports: ["websocket", "polling"] });
  }
  return _socket;
}

export function joinRoute(routeId: string): void {
  getSocket().emit("join:route", routeId);
}

export function leaveRoute(routeId: string): void {
  getSocket().emit("leave:route", routeId);
}

export interface GpsUpdate {
  lat: number;
  lng: number;
  heading?: number;
  speedMph?: number;
  recordedAt: string;
}

export interface ProximityAlert {
  alerts: string[];
  lat: number;
  lng: number;
}

export function onGpsUpdate(cb: (data: GpsUpdate) => void): () => void {
  const socket = getSocket();
  socket.on("gps:update", cb);
  return () => socket.off("gps:update", cb);
}

export function onProximityAlert(cb: (data: ProximityAlert) => void): () => void {
  const socket = getSocket();
  socket.on("alert:proximity", cb);
  return () => socket.off("alert:proximity", cb);
}

export function onStopCompleted(cb: (data: { stopId: string; completedAt: string }) => void): () => void {
  const socket = getSocket();
  socket.on("stop:completed", cb);
  return () => socket.off("stop:completed", cb);
}

export function onRouteComplete(cb: (data: { completedAt: string }) => void): () => void {
  const socket = getSocket();
  socket.on("route:complete", cb);
  return () => socket.off("route:complete", cb);
}

export function pushGpsUpdate(data: { routeId: string; lat: number; lng: number; heading?: number; speedMph?: number }): void {
  getSocket().emit("gps:update", data);
}
