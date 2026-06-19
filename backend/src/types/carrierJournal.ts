export type MailLoad = "light" | "normal" | "heavy" | "brutal";

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
  tags?: string[];
  goodSamaritanAct?: boolean;
};
