import { Router, Request, Response, NextFunction } from "express";
import { buildRouteSummaries } from "../services/routeSummaries.js";
import { buildOpsDashboard } from "../services/opsDashboard.js";

export const adminRouter = Router();

/** Fleet ops snapshot — internal admin view (auth to be added later). */
adminRouter.get("/routes", (_req: Request, res: Response, next: NextFunction): void => {
  try {
    res.json(buildRouteSummaries());
  } catch (err) {
    next(err);
  }
});

/** Supervisor control tower aggregate view. */
function sendOpsDashboard(_req: Request, res: Response, next: NextFunction): void {
  try {
    res.json(buildOpsDashboard());
  } catch (err) {
    next(err);
  }
}

adminRouter.get("/ops-dashboard", sendOpsDashboard);
adminRouter.get("/sunday-dashboard", sendOpsDashboard);
