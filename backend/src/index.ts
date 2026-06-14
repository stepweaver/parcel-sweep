import "dotenv/config";
import { createServer } from "node:http";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { Server as SocketServer } from "socket.io";

import { getDb } from "./db/index.js";
import { optimizeRouteRouter } from "./routes/optimizeRoute.js";
import { manifestsRouter } from "./routes/manifests.js";
import { createRoutesRouter } from "./routes/routes.js";
import { packagesRouter } from "./routes/packages.js";

// ── Bootstrap ────────────────────────────────────────────────
const app = express();
const httpServer = createServer(app);
const PORT = parseInt(process.env.PORT ?? "3000", 10);

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";

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
  res.json({ status: "ok", service: "parcel-sweep" });
});

app.use("/api/optimize-route", optimizeRouteRouter);
app.use("/api/manifests", manifestsRouter);
app.use("/api/routes", createRoutesRouter(io));
app.use("/api/packages", packagesRouter);

// ── 404 ─────────────────────────────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found." });
});

// ── Global error handler ─────────────────────────────────────
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof Error) {
    console.error(`[ERROR] ${err.message}`);
    const status = (err as Error & { status?: number }).status ?? 500;
    res.status(status).json({ error: err.message });
  } else {
    console.error("[ERROR] Unknown error", err);
    res.status(500).json({ error: "An unexpected error occurred." });
  }
});

// ── Socket.io ────────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log(`[WS] Client connected: ${socket.id}`);

  // Client joins a route room to receive route-specific events
  socket.on("join:route", (routeId: string) => {
    socket.join(`route:${routeId}`);
    console.log(`[WS] ${socket.id} joined route:${routeId}`);
  });

  socket.on("leave:route", (routeId: string) => {
    socket.leave(`route:${routeId}`);
  });

  // Client can also push GPS updates directly via socket (alternative to HTTP)
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
  console.log(`\nParcel Sweep backend running on http://localhost:${PORT}`);
  console.log(`  POST  http://localhost:${PORT}/api/manifests/generate`);
  console.log(`  GET   http://localhost:${PORT}/api/manifests`);
  console.log(`  POST  http://localhost:${PORT}/api/routes`);
  console.log(`  POST  http://localhost:${PORT}/api/optimize-route`);
  console.log(`  WebSocket on ws://localhost:${PORT}\n`);
});

export { io };
export default app;
