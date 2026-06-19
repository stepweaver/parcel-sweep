import { Router } from "express";
import {
  getCarrierDispatches,
  isCarrierJournalConfigured,
} from "../services/carrierJournalService.js";

export const carrierJournalRouter = Router();

carrierJournalRouter.get("/dispatches", async (_req, res, next) => {
  try {
    const dispatches = await getCarrierDispatches();
    res.json({
      dispatches,
      source: isCarrierJournalConfigured() ? "notion" : "unconfigured",
    });
  } catch (err) {
    next(err);
  }
});
