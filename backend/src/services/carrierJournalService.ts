import axios from "axios";
import type { CarrierDispatch } from "../types/carrierJournal.js";

type Props = Record<string, unknown>;
type RichTextFragment = { plain_text?: string };

const CACHE_TTL_MS = 5 * 60 * 1000;
let cachedDispatches: CarrierDispatch[] | null = null;
let cachedAt = 0;

function getDbId(): string | null {
  const raw = (process.env.NOTION_CARRIER_JOURNAL_DB_ID ?? "")
    .trim()
    .replace(/^[\s'"`]+|[\s'"`]+$/g, "");
  if (!raw) return null;
  const clean = raw.replace(/-/g, "");
  if (clean.length < 32) return null;
  return `${clean.slice(0, 8)}-${clean.slice(8, 12)}-${clean.slice(12, 16)}-${clean.slice(16, 20)}-${clean.slice(20)}`;
}

function isConfigured(): boolean {
  return !!(getDbId() && (process.env.NOTION_API_KEY ?? "").trim());
}

function str(prop: Props | undefined, key: "title" | "rich_text"): string {
  if (!prop) return "";
  const arr = prop[key] as RichTextFragment[] | undefined;
  return arr?.map((fragment) => fragment.plain_text ?? "").join("") ?? "";
}

function num(prop: Props | undefined): number | undefined {
  if (!prop) return undefined;
  const v = prop.number;
  return typeof v === "number" ? v : undefined;
}

function check(prop: Props | undefined): boolean {
  if (!prop) return false;
  return prop.checkbox === true;
}

function sel(prop: Props | undefined): string {
  if (!prop) return "";
  return (prop.select as { name?: string } | null)?.name ?? "";
}

function dateStr(prop: Props | undefined): string {
  if (!prop) return "";
  const start = (prop.date as { start?: string } | null)?.start ?? "";
  return start.slice(0, 10);
}

function formatPage(page: { id: string; properties: Record<string, unknown> }): CarrierDispatch | null {
  const p = page.properties;
  const date = dateStr(p.Date as Props);
  if (!date) return null;

  const title = str(p.Title as Props, "title") || date;
  const rawLoad = sel(p["Mail Load"] as Props).toLowerCase();
  const mailLoad =
    rawLoad === "light" || rawLoad === "normal" || rawLoad === "heavy" || rawLoad === "brutal"
      ? rawLoad
      : "normal";

  const rawTags = (p.Tags as Props)?.multi_select as { name?: string }[] | undefined;
  const tags = rawTags?.map((t) => t.name ?? "").filter(Boolean);

  return {
    id: `cj-${page.id.replace(/-/g, "").slice(0, 8)}`,
    date,
    title,
    milesWalked: num(p["Miles Walked"] as Props) ?? 0,
    steps: num(p.Steps as Props) ?? 0,
    soreness: num(p["Soreness (1-10)"] as Props) ?? num(p.Soreness as Props) ?? 5,
    energy: num(p["Energy (1-10)"] as Props) ?? num(p.Energy as Props) ?? 5,
    mood: num(p["Mood (1-10)"] as Props) ?? num(p.Mood as Props) ?? 5,
    ...(str(p.Weather as Props, "rich_text") ? { weather: str(p.Weather as Props, "rich_text") } : {}),
    ...(num(p["Temperature F"] as Props) !== undefined ? { temperatureF: num(p["Temperature F"] as Props) } : {}),
    ...(num(p["Heat Index F"] as Props) !== undefined ? { heatIndexF: num(p["Heat Index F"] as Props) } : {}),
    mailLoad,
    ...(check(p["Heat Day"] as Props) ? { heatDay: true } : {}),
    ...(check(p.Rain as Props) ? { rain: true } : {}),
    ...(check(p.Storm as Props) ? { storm: true } : {}),
    ...(check(p.Snow as Props) ? { snow: true } : {}),
    ...(check(p["Dog Encounter"] as Props) ? { dogEncounter: true } : {}),
    publicNote: str(p["Public Note"] as Props, "rich_text"),
    ...(num(p["Water Oz"] as Props) !== undefined ? { waterOz: num(p["Water Oz"] as Props) } : {}),
    ...(num(p["Hydration Goal Oz"] as Props) !== undefined
      ? { hydrationGoalOz: num(p["Hydration Goal Oz"] as Props) }
      : {}),
    ...(check(p["Good Samaritan Act"] as Props) ? { goodSamaritanAct: true } : {}),
    ...(tags && tags.length > 0 ? { tags } : {}),
  };
}

async function fetchFromNotion(): Promise<CarrierDispatch[]> {
  const dbId = getDbId();
  const apiKey = (process.env.NOTION_API_KEY ?? "").trim();
  if (!dbId || !apiKey) return [];

  const items: CarrierDispatch[] = [];
  let cursor: string | undefined;

  try {
    while (true) {
      const res = await axios.post<{
        results: Array<{ id: string; properties: Record<string, unknown> }>;
        has_more: boolean;
        next_cursor: string | null;
      }>(
        `https://api.notion.com/v1/databases/${dbId}/query`,
        {
          filter: { property: "Publish Public", checkbox: { equals: true } },
          sorts: [{ property: "Date", direction: "descending" }],
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Notion-Version": "2022-06-28",
            "Content-Type": "application/json",
          },
          timeout: 15000,
        }
      );

      for (const page of res.data.results ?? []) {
        const dispatch = formatPage(page);
        if (dispatch) items.push(dispatch);
      }

      if (!res.data.has_more || !res.data.next_cursor) break;
      cursor = res.data.next_cursor;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[carrier-journal] fetchFromNotion:", message);
    return [];
  }

  return items;
}

export async function getCarrierDispatches(): Promise<CarrierDispatch[]> {
  if (!isConfigured()) return [];

  const now = Date.now();
  if (cachedDispatches && now - cachedAt < CACHE_TTL_MS) {
    return cachedDispatches;
  }

  cachedDispatches = await fetchFromNotion();
  cachedAt = now;
  return cachedDispatches;
}

export function isCarrierJournalConfigured(): boolean {
  return isConfigured();
}
