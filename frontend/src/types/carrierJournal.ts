/** Letter carrier field log — public-safe subset for milestone / rank display. */

export type MailLoad = "light" | "normal" | "heavy" | "brutal";

export type WeightPublicMode = "hidden" | "change-only" | "current-and-change";

export type CarrierPhase = "break-in" | "adapting" | "building" | "regular";

export type RoutePreference = "prefer" | "like" | "dislike";

export type CarrierDispatch = {
  id: string;
  date: string;
  title: string;
  milesWalked: number;
  steps?: number;
  soreness: number;
  energy: number;
  mood: number;
  weather?: string;
  temperatureF?: number;
  heatIndexF?: number;
  mailLoad: MailLoad;
  heatDay?: boolean;
  rain?: boolean;
  storm?: boolean;
  snow?: boolean;
  dogEncounter?: boolean;
  publicNote: string;
  waterOz?: number;
  hydrationGoalOz?: number;
  weightLbs?: number;
  weightPublicMode?: WeightPublicMode;
  bodyNote?: string;
  recoveryNote?: string;
  phase?: CarrierPhase;
  tags?: string[];
  goodSamaritanAct?: boolean;
  routeCode?: string;
  routePreference?: RoutePreference;
};
