/**
 * Deterministic batch-address segmentation and conservative speech-number
 * normalization. Does not split on commas or the word "and".
 */

export interface SegmentedAddress {
  rawInput: string;
  searchInput: string;
  express: boolean;
}

const DELIMITER_PHRASE =
  /(?:\r?\n)+|(?:[\s,.;:!?-]*)\b(?:next\s+address|new\s+address|next\s+stop)\b(?:[\s,.;:!?-]*)/gi;

const ONES: Record<string, number> = {
  zero: 0,
  oh: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
};

const TEENS: Record<string, number> = {
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

function normalizeToken(token: string): string {
  return token.toLowerCase().replace(/[^a-z]/g, "");
}

function isOnes(word: string): boolean {
  return Object.prototype.hasOwnProperty.call(ONES, word) && word !== "oh" && word !== "zero";
}

function isOh(word: string): boolean {
  return word === "oh";
}

function isTeen(word: string): boolean {
  return Object.prototype.hasOwnProperty.call(TEENS, word);
}

function isTens(word: string): boolean {
  return Object.prototype.hasOwnProperty.call(TENS, word);
}

function isNumberWord(word: string): boolean {
  return (
    Object.prototype.hasOwnProperty.call(ONES, word) ||
    isTeen(word) ||
    isTens(word) ||
    word === "hundred" ||
    word === "thousand"
  );
}

export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function stripEdgePunctuation(text: string): string {
  return text.replace(/^[,.;:!?-]+/, "").replace(/[,.;:!?-]+$/, "").trim();
}

const STREET_SUFFIX =
  "(?:parkways?|pkwy|boulevards?|blvd|avenues?|ave|streets?|st|roads?|rd|drives?|dr|lanes?|ln|courts?|ct|places?|pl|ways?|circles?|cir|terraces?|ter|trails?|trl)";

const AFTER_STREET_NEW_HOUSE = new RegExp(
  String.raw`(?:\b${STREET_SUFFIX}\b|\bexpress\b)[.,;:!?]*\s+(?=\d{2,5}\b)`,
  "gi"
);

/**
 * Strip a standalone "express" token. rawInput keeps the original words;
 * search/address input does not treat express as part of the street.
 */
export function extractExpressFlag(text: string): { text: string; express: boolean } {
  const trimmed = normalizeWhitespace(text);
  if (!trimmed) return { text: "", express: false };
  const express = /\bexpress\b/i.test(trimmed);
  const stripped = normalizeWhitespace(trimmed.replace(/\bexpress\b[.,;:!?]*/gi, " "));
  return { text: stripped, express };
}

/**
 * Split a spoken or punctuated run when a new house number follows a street suffix.
 * "2221 South Olive Street 2107 South Mead Street" → two addresses.
 */
export function splitOnNewHouseAfterStreet(text: string): string[] {
  const trimmed = normalizeWhitespace(text);
  if (!trimmed) return [];
  const parts: string[] = [];
  const re = new RegExp(AFTER_STREET_NEW_HOUSE.source, AFTER_STREET_NEW_HOUSE.flags);
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(trimmed)) !== null) {
    const splitAt = match.index + match[0].length;
    const chunk = stripEdgePunctuation(trimmed.slice(last, splitAt));
    if (chunk) parts.push(chunk);
    last = splitAt;
  }
  const tail = stripEdgePunctuation(trimmed.slice(last));
  if (tail) parts.push(tail);
  return parts.length > 0 ? parts : [];
}

/**
 * Convert a leading run of English number-words into digits for search.
 * Conservative: if the parse is incomplete or uses scale words (hundred),
 * the original text is returned unchanged. rawInput is never modified here.
 */
export function normalizeSpokenHouseNumber(input: string): string {
  const trimmed = normalizeWhitespace(input);
  if (!trimmed) return trimmed;

  const tokens = trimmed.split(/[\s-]+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return trimmed;

  const firstNorm = normalizeToken(tokens[0]);
  if (/^\d+[a-z]?$/.test(tokens[0].toLowerCase()) || !isNumberWord(firstNorm)) {
    return trimmed;
  }

  const digitGroups: string[] = [];
  let i = 0;

  while (i < tokens.length) {
    const word = normalizeToken(tokens[i]);
    if (!isNumberWord(word)) break;
    if (word === "hundred" || word === "thousand") {
      return trimmed;
    }

    if (isTens(word) && i + 1 < tokens.length) {
      const next = normalizeToken(tokens[i + 1]);
      if (isOnes(next)) {
        digitGroups.push(String(TENS[word] + ONES[next]));
        i += 2;
        continue;
      }
    }

    if (isTens(word)) {
      digitGroups.push(String(TENS[word]));
      i += 1;
      continue;
    }

    if (isTeen(word)) {
      digitGroups.push(String(TEENS[word]));
      i += 1;
      continue;
    }

    if (isOh(word) && i + 1 < tokens.length) {
      const next = normalizeToken(tokens[i + 1]);
      if (isOnes(next)) {
        digitGroups.push(`0${ONES[next]}`);
        i += 2;
        continue;
      }
    }

    if (Object.prototype.hasOwnProperty.call(ONES, word)) {
      digitGroups.push(String(ONES[word]));
      i += 1;
      continue;
    }

    return trimmed;
  }

  if (i === 0 || i >= tokens.length) return trimmed;

  const nextWord = normalizeToken(tokens[i] ?? "");
  if (nextWord === "and") return trimmed;

  const house = digitGroups.join("");
  if (house.length < 2 || house.length > 5) return trimmed;

  const rest = tokens.slice(i).join(" ");
  return normalizeWhitespace(`${house} ${rest}`);
}

export function segmentAddresses(text: string): SegmentedAddress[] {
  if (!text || !text.trim()) return [];

  const parts = text.split(DELIMITER_PHRASE);
  const out: SegmentedAddress[] = [];

  for (const part of parts) {
    const rawBlock = normalizeWhitespace(stripEdgePunctuation(part));
    if (!rawBlock) continue;
    const pieces = splitOnNewHouseAfterStreet(rawBlock);
    for (const piece of pieces.length > 0 ? pieces : [rawBlock]) {
      const rawInput = normalizeWhitespace(stripEdgePunctuation(piece));
      if (!rawInput) continue;
      const extracted = extractExpressFlag(rawInput);
      const searchable = extracted.text || rawInput;
      out.push({
        rawInput,
        searchInput: normalizeSpokenHouseNumber(searchable),
        express: extracted.express,
      });
    }
  }

  return out;
}

/** Backward-compatible helper: original heard/pasted strings only. */
export function parsePastedAddresses(text: string): string[] {
  return segmentAddresses(text).map((entry) => entry.rawInput);
}

export function appendTranscript(existing: string, addition: string): string {
  const add = addition.replace(/\s+/g, " ").trim();
  if (!add) return existing;
  const base = existing.replace(/\s+$/g, "");
  if (!base.trim()) return add;
  return `${base} ${add}`;
}
