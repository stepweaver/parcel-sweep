import { segmentAddresses, type SegmentedAddress } from "./addressSegmenter.js";

export const ADDRESS_PARSER_MAX_CHARS = 12_000;

const PARSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["addresses"],
  properties: {
    addresses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["rawInput", "addressInput", "express"],
        properties: {
          rawInput: { type: "string" },
          addressInput: { type: "string" },
          express: { type: "boolean" },
        },
      },
    },
  },
} as const;

export interface ParsedCaptureAddress {
  rawInput: string;
  addressInput: string;
  express: boolean;
}

export type AddressParserSource = "heuristic" | "openai";

export interface ParseAddressListResult {
  addresses: ParsedCaptureAddress[];
  source: AddressParserSource;
}

export function isOpenAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

function fromSegments(segments: SegmentedAddress[]): ParsedCaptureAddress[] {
  return segments.map((segment) => ({
    rawInput: segment.rawInput,
    addressInput: segment.searchInput,
    express: segment.express,
  }));
}

function sanitizeParsed(addresses: unknown): ParsedCaptureAddress[] {
  if (!Array.isArray(addresses)) return [];
  const out: ParsedCaptureAddress[] = [];
  for (const item of addresses) {
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;
    const rawInput = typeof rec.rawInput === "string" ? rec.rawInput.replace(/\s+/g, " ").trim() : "";
    const addressInput =
      typeof rec.addressInput === "string" ? rec.addressInput.replace(/\s+/g, " ").trim() : "";
    if (!rawInput && !addressInput) continue;
    out.push({
      rawInput: rawInput || addressInput,
      addressInput: addressInput || rawInput,
      express: rec.express === true,
    });
  }
  return out;
}

function chooseParse(
  text: string,
  heuristic: ParsedCaptureAddress[],
  ai: ParsedCaptureAddress[] | null
): ParseAddressListResult {
  if (!ai || ai.length === 0) {
    return { addresses: heuristic, source: "heuristic" };
  }
  const newlineCount = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).length;
  if (newlineCount >= 2 && heuristic.length >= newlineCount && heuristic.length >= ai.length) {
    return { addresses: heuristic, source: "heuristic" };
  }
  return { addresses: ai, source: "openai" };
}

async function parseWithOpenAi(text: string): Promise<ParsedCaptureAddress[] | null> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "You extract South Bend, Indiana parcel-delivery stops from messy spoken or pasted text. Split into one address per package. Normalize street abbreviations (South→S, Street→St, Avenue→Ave, West→W). The word express is a service flag, never part of the street. Do not invent addresses, cities, ZIPs, or coordinates. Preserve order. rawInput is the original words for that stop; addressInput is the normalized street line only.",
          },
          {
            role: "user",
            content: text,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "address_list",
            strict: true,
            schema: PARSE_SCHEMA,
          },
        },
      }),
    });
    if (!response.ok) {
      console.warn("[capture:parse] OpenAI HTTP", response.status);
      return null;
    }
    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content) as { addresses?: unknown };
    return sanitizeParsed(parsed.addresses);
  } catch (err) {
    console.warn(
      "[capture:parse] OpenAI failed",
      err instanceof Error ? err.message : err
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Turn a capture transcript into structured stops.
 * Heuristic split is always available. OpenAI structured output is used when
 * configured and it does not lose a clean newline-delimited paste.
 */
export async function parseAddressList(text: string): Promise<ParseAddressListResult> {
  const clipped = text.slice(0, ADDRESS_PARSER_MAX_CHARS);
  const heuristic = fromSegments(segmentAddresses(clipped));
  const newlineCount = clipped.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).length;
  if (!isOpenAiConfigured()) {
    return { addresses: heuristic, source: "heuristic" };
  }
  if (newlineCount >= 2 && heuristic.length >= newlineCount) {
    return { addresses: heuristic, source: "heuristic" };
  }
  const ai = await parseWithOpenAi(clipped);
  return chooseParse(clipped, heuristic, ai);
}

export function parseAddressListHeuristic(text: string): ParseAddressListResult {
  return {
    addresses: fromSegments(segmentAddresses(text.slice(0, ADDRESS_PARSER_MAX_CHARS))),
    source: "heuristic",
  };
}
