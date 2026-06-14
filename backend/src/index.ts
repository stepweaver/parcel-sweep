import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { Server as SocketServer } from "socket.io";

import { getDb } from "./db/index.js";
import { isGoogleGeocodingConfigured } from "./services/geocoder.js";
import { optimizeRouteRouter } from "./routes/optimizeRoute.js";
import { manifestsRouter } from "./routes/manifests.js";
import { createRoutesRouter } from "./routes/routes.js";
import { packagesRouter } from "./routes/packages.js";

function resolveFrontendOrigin(): string {
  if (process.env.FRONTEND_ORIGIN) return process.env.FRONTEND_ORIGIN;
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL;
  return "http://localhost:5173";
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIST = path.resolve(__dirname, "../../frontend/dist");
const serveFrontend = fs.existsSync(path.join(FRONTEND_DIST, "index.html"));

// ── Bootstrap ────────────────────────────────────────────────
const app = express();
const httpServer = createServer(app);
const PORT = parseInt(process.env.PORT ?? "3000", 10);
const FRONTEND_ORIGIN = resolveFrontendOrigin();

const io = new SocketServer(httpServer, {
  cors: { origin: FRONTEND_ORIGIN, methods: ["GET", "POST"] },
});

// Initialise the database (runs CREATE TABLE IF NOT EXISTS)
getDb();

// ── Middleware ───────────────────────────────────────────────
app.use(cors({ origin: FRONTEND_ORIGIN }));
app.use(express.json({ limit: "4mb" }));

app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ── HTTP Routes ──────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "parcel-sweep",
    config: {
      googleGeocoding: isGoogleGeocodingConfigured(),
      geocodingFallback: "nominatim",
      osrm: process.env.OSRM_BASE_URL ?? "http://router.project-osrm.org",
    },
  });
});

app.use("/api/optimize-route", optimizeRouteRouter);
app.use("/api/manifests", manifestsRouter);
app.use("/api/routes", createRoutesRouter(io));
app.use("/api/packages", packagesRouter);

// ── Production frontend (Vite build) ─────────────────────────
if (serveFrontend) {
  app.use(express.static(FRONTEND_DIST, { index: false }));

  app.get("*", (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/socket.io")) {
      next();
      return;
    }
    res.sendFile(path.join(FRONTEND_DIST, "index.html"));
  });
}

// ── 404 ─────────────────────────────────────────────────────
app.use((req: Request, res: Response) => {
  if (req.path.startsWith("/api")) {
    res.status(404).json({ error: "Not found." });
    return;
  }
  res.status(404).send("Not found.");
});

// ── Global error handler ─────────────────────────────────────
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof Error) {
    console.error(`[ERROR] ${err.message}`);
    res.status(500).json({ error: err.message });
  } else {
    console.error("[ERROR] Unknown error", err);
    res.status(500).json({ error: "An unexpected error occurred." });
  }
});

// ── Socket.io ────────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log(`[WS] Client connected: ${socket.id}`);

  socket.on("join:route", (routeId: string) => {
    socket.join(`route:${routeId}`);
    console.log(`[WS] ${socket.id} joined route:${routeId}`);
  });

  socket.on("leave:route", (routeId: string) => {
    socket.leave(`route:${routeId}`);
  });

  socket.on("gps:update", (data: { routeId: string; lat: number; lng: number; heading?: number; speedMph?: number }) => {
    io.to(`route:${data.routeId}`).emit("gps:update", {
      lat: data.lat,
      lng: data.lng,
      heading: data.heading,
      speedMph: data.speedMph,
      recordedAt: new Date().toISOString(),
    });
  });

  socket.on("disconnect", () => {
    console.log(`[WS] Client disconnected: ${socket.id}`);
  });
});

// ── Start ────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`\nParcel Sweep running on port ${PORT}`);
  console.log(`  CORS origin: ${FRONTEND_ORIGIN}`);
  console.log(`  Frontend:    ${serveFrontend ? "serving /frontend/dist" : "dev only (run Vite separately)"}`);
  console.log(`  POST  /api/manifests/generate`);
  console.log(`  GET   /api/manifests`);
  console.log(`  POST  /api/routes`);
  console.log(`  POST  /api/routes/:id/optimize`);
  console.log(`  GET   /api/routes/:id/load-order`);
  console.log(`  GET   /api/routes/:id/export/{gpx,kml,csv}`);
  console.log(`  Geocoding:   ${isGoogleGeocodingConfigured() ? "Google API key set" : "Google not set — using OpenStreetMap fallback"}`);
  console.log(`  WebSocket /socket.io\n`);
});

export { io };
export default app;
