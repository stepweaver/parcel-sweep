import type { CarrierDispatch } from "../types/carrierJournal";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CarrierMilestoneCategory =
  | "days"
  | "distance"
  | "weather"
  | "load"
  | "safety"
  | "service"
  | "hydration";

export type CarrierMilestoneTier =
  | "basic"
  | "field"
  | "campaign"
  | "veteran";

export type CarrierMilestone = {
  id: string;
  title: string;
  shortLabel: string;
  description: string;
  category: CarrierMilestoneCategory;
  tier: CarrierMilestoneTier;
  icon: string;
  unlocked: boolean;
  progress: number;
  target: number;
  progressLabel: string;
  unlockedAt?: string;
};

export type CarrierLevel = {
  title: string;
  level: number;
  totalLevels: number;
  totalMiles: number;
  nextTitle?: string;
  nextMiles?: number;
  progressToNext: number;
};

export type CarrierRank = {
  level: number;
  title: string;
  miles: number;
  status: "reached" | "current" | "locked";
  milesRemaining: number;
};

// ---------------------------------------------------------------------------
// Mileage rank ladder
// ---------------------------------------------------------------------------

const LEVEL_THRESHOLDS: { miles: number; title: string; level: number }[] = [
  { miles: 0,     title: "Recruit Walker",    level: 1 },
  { miles: 25,    title: "First Loop",        level: 2 },
  { miles: 50,    title: "Route Walker",      level: 3 },
  { miles: 100,   title: "Foot Patrol",       level: 4 },
  { miles: 250,   title: "Satchel Qualified", level: 5 },
  { miles: 500,   title: "Mailwalker",        level: 6 },
  { miles: 1000,  title: "Route Veteran",     level: 7 },
  { miles: 2500,  title: "Relay Commander",   level: 8 },
  { miles: 5000,  title: "Iron Route",        level: 9 },
  { miles: 10000, title: "Carrier Legend",    level: 10 },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sortedChronologically(dispatches: CarrierDispatch[]): CarrierDispatch[] {
  return [...dispatches].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );
}

/** Find the date of the Nth dispatch matching a predicate (1-indexed). */
function dateAtNthMatch(
  sorted: CarrierDispatch[],
  predicate: (dispatch: CarrierDispatch) => boolean,
  n: number
): string | undefined {
  let count = 0;
  for (const d of sorted) {
    if (predicate(d)) {
      count++;
      if (count >= n) return d.date;
    }
  }
  return undefined;
}

/** Find the date at which the cumulative sum of getValue() first hits threshold. */
function dateAtCumulativeThreshold(
  sorted: CarrierDispatch[],
  getValue: (dispatch: CarrierDispatch) => number,
  threshold: number
): string | undefined {
  let cumulative = 0;
  for (const d of sorted) {
    cumulative += getValue(d);
    if (cumulative >= threshold) return d.date;
  }
  return undefined;
}

function isGoodSamaritanAct(d: CarrierDispatch): boolean {
  if (d.goodSamaritanAct === true) return true;
  return (d.tags ?? []).some(
    (t) =>
      t === "good-samaritan" ||
      t === "good_samaritan" ||
      t.toLowerCase() === "good samaritan"
  );
}

function effectiveTemp(d: CarrierDispatch): number {
  return Math.max(d.temperatureF ?? -Infinity, d.heatIndexF ?? -Infinity);
}

function isWeatherDay(d: CarrierDispatch): boolean {
  return !!(d.rain || d.storm || d.snow || d.heatDay);
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

export function getCarrierLevel(dispatches: CarrierDispatch[]): CarrierLevel {
  const totalMiles = dispatches.reduce((s, d) => s + d.milesWalked, 0);
  const rounded = Math.round(totalMiles * 10) / 10;

  let currentIdx = 0;
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (totalMiles >= LEVEL_THRESHOLDS[i].miles) {
      currentIdx = i;
      break;
    }
  }

  const current = LEVEL_THRESHOLDS[currentIdx];
  const next = LEVEL_THRESHOLDS[currentIdx + 1] ?? null;

  let progressToNext = 100;
  if (next) {
    const span = next.miles - current.miles;
    const progress = totalMiles - current.miles;
    progressToNext = Math.min(100, Math.round((progress / span) * 100));
  }

  return {
    title: current.title,
    level: current.level,
    totalLevels: LEVEL_THRESHOLDS.length,
    totalMiles: rounded,
    ...(next ? { nextTitle: next.title, nextMiles: next.miles } : {}),
    progressToNext,
  };
}

export function getCarrierRankLadder(totalMiles: number): CarrierRank[] {
  const rounded = Math.round(totalMiles * 10) / 10;

  let currentIdx = 0;
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (totalMiles >= LEVEL_THRESHOLDS[i].miles) {
      currentIdx = i;
      break;
    }
  }

  return LEVEL_THRESHOLDS.map((threshold, idx) => {
    const reached = totalMiles >= threshold.miles;
    const status: CarrierRank["status"] =
      idx === currentIdx ? "current" : reached ? "reached" : "locked";

    const milesRemaining =
      status === "reached"
        ? 0
        : Math.max(0, Math.round((threshold.miles - rounded) * 10) / 10);

    return {
      level: threshold.level,
      title: threshold.title,
      miles: threshold.miles,
      status,
      milesRemaining,
    };
  });
}

export function getCarrierMilestones(dispatches: CarrierDispatch[]): CarrierMilestone[] {
  const sorted = sortedChronologically(dispatches);
  const totalMiles = dispatches.reduce((s, d) => s + d.milesWalked, 0);
  const daysLogged = dispatches.length;

  const rainDays = dispatches.filter((d) => d.rain);
  const stormDays = dispatches.filter((d) => d.storm);
  const snowDays = dispatches.filter((d) => d.snow);
  const heatDays = dispatches.filter((d) => d.heatDay || effectiveTemp(d) >= 90);
  const weatherDays = dispatches.filter(isWeatherDay);
  const heavyOrBrutalDays = dispatches.filter(
    (d) => d.mailLoad === "heavy" || d.mailLoad === "brutal"
  );
  const dogDays = dispatches.filter((d) => d.dogEncounter);
  const hydrationGoalDays = dispatches.filter(
    (d) =>
      d.waterOz !== undefined &&
      d.hydrationGoalOz !== undefined &&
      d.waterOz >= d.hydrationGoalOz
  );
  const goodSamaritanDays = dispatches.filter(isGoodSamaritanAct);

  function milestone(
    id: string,
    title: string,
    shortLabel: string,
    description: string,
    category: CarrierMilestoneCategory,
    tier: CarrierMilestoneTier,
    icon: string,
    current: number,
    target: number,
    unlockedAt: string | undefined,
    unit = ""
  ): CarrierMilestone {
    const unlocked = current >= target;
    const progress = Math.min(current, target);
    const progressLabel =
      unit
        ? `${progress.toLocaleString()} / ${target.toLocaleString()} ${unit}`
        : `${progress.toLocaleString()} / ${target.toLocaleString()}`;
    return {
      id,
      title,
      shortLabel,
      description,
      category,
      tier,
      icon,
      unlocked,
      progress,
      target,
      progressLabel,
      ...(unlocked && unlockedAt ? { unlockedAt } : {}),
    };
  }

  return [
    // ===================================================================
    // BASIC QUALIFICATION
    // ===================================================================

    // --- Days ---
    milestone(
      "day-one",
      "Day One",
      "Day 1",
      "First dispatch logged. The field record starts here.",
      "days", "basic", "calendar",
      daysLogged, 1,
      dateAtNthMatch(sorted, () => true, 1),
      "days"
    ),
    milestone(
      "five-logged-days",
      "5 Logged Days",
      "5 Days",
      "Five field days on the record. The soreness is real. So is the routine.",
      "days", "basic", "calendar",
      daysLogged, 5,
      dateAtNthMatch(sorted, () => true, 5),
      "days"
    ),
    milestone(
      "ten-logged-days",
      "10 Logged Days",
      "10 Days",
      "Ten logged days. Route rhythm is starting to take shape.",
      "days", "basic", "calendar",
      daysLogged, 10,
      dateAtNthMatch(sorted, () => true, 10),
      "days"
    ),

    // --- Distance ---
    milestone(
      "first-mile",
      "First Mile",
      "1 mi",
      "One mile on the record. Every field career starts somewhere.",
      "distance", "basic", "map-pin",
      totalMiles, 1,
      dateAtCumulativeThreshold(sorted, (d) => d.milesWalked, 1),
      "mi"
    ),
    milestone(
      "ten-miles",
      "10 Miles",
      "10 mi",
      "Ten miles accumulated. The body is learning what this job costs.",
      "distance", "basic", "map-pin",
      totalMiles, 10,
      dateAtCumulativeThreshold(sorted, (d) => d.milesWalked, 10),
      "mi"
    ),

    // --- Weather ---
    milestone(
      "first-rain",
      "First Rain",
      "Rain",
      "First route completed in the rain. Gear tested.",
      "weather", "basic", "cloud-rain",
      rainDays.length, 1,
      rainDays.length >= 1 ? sortedChronologically(rainDays)[0]?.date : undefined
    ),

    // --- Load ---
    milestone(
      "first-heavy-day",
      "First Heavy Day",
      "Heavy",
      "First dispatch logged as heavy or brutal mail load.",
      "load", "basic", "package",
      heavyOrBrutalDays.length, 1,
      heavyOrBrutalDays.length >= 1
        ? sortedChronologically(heavyOrBrutalDays)[0]?.date
        : undefined
    ),

    // --- Hydration ---
    milestone(
      "first-hydration-goal",
      "First Hydration Goal",
      "Goal",
      "First day hitting the full hydration target. Discipline recorded.",
      "hydration", "basic", "droplets",
      hydrationGoalDays.length, 1,
      hydrationGoalDays.length >= 1
        ? sortedChronologically(hydrationGoalDays)[0]?.date
        : undefined
    ),

    // ===================================================================
    // FIELD QUALIFICATION
    // ===================================================================

    // --- Days ---
    milestone(
      "twenty-five-logged-days",
      "25 Logged Days",
      "25 Days",
      "Twenty-five field days. A real track record is forming.",
      "days", "field", "calendar",
      daysLogged, 25,
      dateAtNthMatch(sorted, () => true, 25),
      "days"
    ),

    // --- Distance ---
    milestone(
      "fifty-miles",
      "50 Miles",
      "50 mi",
      "Fifty miles under your boots. The route is becoming yours.",
      "distance", "field", "map-pin",
      totalMiles, 50,
      dateAtCumulativeThreshold(sorted, (d) => d.milesWalked, 50),
      "mi"
    ),
    milestone(
      "hundred-miles",
      "100 Miles",
      "100 mi",
      "One hundred miles on foot. A real carrier milestone.",
      "distance", "field", "map-pin",
      totalMiles, 100,
      dateAtCumulativeThreshold(sorted, (d) => d.milesWalked, 100),
      "mi"
    ),

    // --- Hydration ---
    milestone(
      "five-hydration-goals",
      "5 Hydration Goals",
      "5x Goal",
      "Five days hitting the hydration target. A system is forming.",
      "hydration", "field", "droplets",
      hydrationGoalDays.length, 5,
      dateAtNthMatch(
        sorted,
        (d) =>
          d.waterOz !== undefined &&
          d.hydrationGoalOz !== undefined &&
          d.waterOz >= d.hydrationGoalOz,
        5
      )
    ),

    // --- Load ---
    milestone(
      "five-heavy-days",
      "5 Heavy Days",
      "5 Heavy",
      "Five heavy or brutal load days on the record.",
      "load", "field", "package",
      heavyOrBrutalDays.length, 5,
      dateAtNthMatch(sorted, (d) => d.mailLoad === "heavy" || d.mailLoad === "brutal", 5)
    ),

    // --- Weather ---
    milestone(
      "first-heat-day",
      "First Heat Day",
      "Heat",
      "First dispatch logged on a heat day. Hydration becomes survival.",
      "weather", "field", "flame",
      heatDays.length, 1,
      heatDays.length >= 1 ? sortedChronologically(heatDays)[0]?.date : undefined
    ),
    milestone(
      "first-storm",
      "First Storm",
      "Storm",
      "First route completed in storm conditions. Conditions were real.",
      "weather", "field", "zap",
      stormDays.length, 1,
      stormDays.length >= 1 ? sortedChronologically(stormDays)[0]?.date : undefined
    ),

    // --- Safety ---
    milestone(
      "first-dog-encounter",
      "First Dog Encounter",
      "Dog",
      "First logged dog encounter. Assessed and redirected.",
      "safety", "field", "shield",
      dogDays.length, 1,
      dogDays.length >= 1 ? sortedChronologically(dogDays)[0]?.date : undefined
    ),

    // ===================================================================
    // CAMPAIGN QUALIFICATION
    // ===================================================================

    // --- Days ---
    milestone(
      "fifty-logged-days",
      "50 Logged Days",
      "50 Days",
      "Fifty field days. Not a rookie anymore.",
      "days", "campaign", "calendar",
      daysLogged, 50,
      dateAtNthMatch(sorted, () => true, 50),
      "days"
    ),

    // --- Distance ---
    milestone(
      "two-fifty-miles",
      "250 Miles",
      "250 mi",
      "Two hundred fifty miles of field work. Satchel-hardened.",
      "distance", "campaign", "map-pin",
      totalMiles, 250,
      dateAtCumulativeThreshold(sorted, (d) => d.milesWalked, 250),
      "mi"
    ),
    milestone(
      "five-hundred-miles",
      "500 Miles",
      "500 mi",
      "Five hundred miles on foot. The route is part of you now.",
      "distance", "campaign", "map-pin",
      totalMiles, 500,
      dateAtCumulativeThreshold(sorted, (d) => d.milesWalked, 500),
      "mi"
    ),

    // --- Weather ---
    milestone(
      "ten-heat-days",
      "10 Heat Days",
      "10 Heat",
      "Ten heat days worked and logged. The body has adapted.",
      "weather", "campaign", "flame",
      heatDays.length, 10,
      dateAtNthMatch(sorted, (d) => !!(d.heatDay || effectiveTemp(d) >= 90), 10)
    ),
    milestone(
      "ten-weather-days",
      "10 Weather Days",
      "10 Wx",
      "Ten days in meaningful weather: rain, storm, snow, or heat.",
      "weather", "campaign", "cloud-rain",
      weatherDays.length, 10,
      dateAtNthMatch(sorted, isWeatherDay, 10)
    ),
    milestone(
      "first-snow",
      "First Snow",
      "Snow",
      "First route completed in snow. A different kind of challenge.",
      "weather", "campaign", "snowflake",
      snowDays.length, 1,
      snowDays.length >= 1 ? sortedChronologically(snowDays)[0]?.date : undefined
    ),

    // --- Hydration ---
    milestone(
      "twenty-five-hydration-goals",
      "25 Hydration Goals",
      "25x Goal",
      "Twenty-five hydration goal days. Consistency on record.",
      "hydration", "campaign", "droplets",
      hydrationGoalDays.length, 25,
      dateAtNthMatch(
        sorted,
        (d) =>
          d.waterOz !== undefined &&
          d.hydrationGoalOz !== undefined &&
          d.waterOz >= d.hydrationGoalOz,
        25
      )
    ),

    // --- Load ---
    milestone(
      "ten-heavy-days",
      "10 Heavy Days",
      "10 Heavy",
      "Ten heavy or brutal load days on the record. Character built.",
      "load", "campaign", "package",
      heavyOrBrutalDays.length, 10,
      dateAtNthMatch(sorted, (d) => d.mailLoad === "heavy" || d.mailLoad === "brutal", 10)
    ),

    // --- Service ---
    milestone(
      "first-good-samaritan",
      "Good Samaritan",
      "Samaritan",
      "First Good Samaritan act logged on the route.",
      "service", "campaign", "heart",
      goodSamaritanDays.length, 1,
      goodSamaritanDays.length >= 1
        ? sortedChronologically(goodSamaritanDays)[0]?.date
        : undefined
    ),

    // ===================================================================
    // VETERAN RECORD
    // ===================================================================

    // --- Days ---
    milestone(
      "hundred-logged-days",
      "100 Logged Days",
      "100 Days",
      "One hundred logged dispatches. A genuine field service milestone.",
      "days", "veteran", "calendar",
      daysLogged, 100,
      dateAtNthMatch(sorted, () => true, 100),
      "days"
    ),

    // --- Distance ---
    milestone(
      "thousand-miles",
      "1,000 Miles",
      "1K mi",
      "One thousand miles on foot. Routebound.",
      "distance", "veteran", "map-pin",
      totalMiles, 1000,
      dateAtCumulativeThreshold(sorted, (d) => d.milesWalked, 1000),
      "mi"
    ),
    milestone(
      "twenty-five-hundred-miles",
      "2,500 Miles",
      "2.5K mi",
      "Twenty-five hundred miles. Relay Commander territory.",
      "distance", "veteran", "map-pin",
      totalMiles, 2500,
      dateAtCumulativeThreshold(sorted, (d) => d.milesWalked, 2500),
      "mi"
    ),

    // --- Hydration ---
    milestone(
      "hundred-hydration-goals",
      "100 Hydration Goals",
      "100x Goal",
      "One hundred hydration goal days. A documented commitment to field safety.",
      "hydration", "veteran", "droplets",
      hydrationGoalDays.length, 100,
      dateAtNthMatch(
        sorted,
        (d) =>
          d.waterOz !== undefined &&
          d.hydrationGoalOz !== undefined &&
          d.waterOz >= d.hydrationGoalOz,
        100
      )
    ),

    // --- Weather ---
    milestone(
      "twenty-five-heat-days",
      "25 Heat Days",
      "25 Heat",
      "Twenty-five heat days worked. Heat-tested and qualified.",
      "weather", "veteran", "flame",
      heatDays.length, 25,
      dateAtNthMatch(sorted, (d) => !!(d.heatDay || effectiveTemp(d) >= 90), 25)
    ),
    milestone(
      "twenty-five-weather-days",
      "25 Weather Days",
      "25 Wx",
      "Twenty-five weather days on record. Conditions are never a surprise.",
      "weather", "veteran", "cloud-rain",
      weatherDays.length, 25,
      dateAtNthMatch(sorted, isWeatherDay, 25)
    ),

    // --- Load ---
    milestone(
      "fifty-heavy-days",
      "50 Heavy Days",
      "50 Heavy",
      "Fifty heavy or brutal load days on the record. Field-hardened.",
      "load", "veteran", "package",
      heavyOrBrutalDays.length, 50,
      dateAtNthMatch(sorted, (d) => d.mailLoad === "heavy" || d.mailLoad === "brutal", 50)
    ),

    // --- Safety ---
    milestone(
      "twenty-five-dog-encounters",
      "25 Dog Encounters",
      "25 Dogs",
      "Twenty-five logged dog encounters. Reading the route is second nature.",
      "safety", "veteran", "shield",
      dogDays.length, 25,
      dateAtNthMatch(sorted, (d) => !!d.dogEncounter, 25)
    ),

    // --- Service ---
    milestone(
      "five-good-samaritan",
      "5 Good Samaritan Notes",
      "5 Sam.",
      "Five Good Samaritan acts on the field record.",
      "service", "veteran", "heart",
      goodSamaritanDays.length, 5,
      dateAtNthMatch(sorted, isGoodSamaritanAct, 5)
    ),
  ];
}
