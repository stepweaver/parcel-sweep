import { isOpenAiConfigured } from "./addressParser.js";

export const MAX_CAPTURE_AUDIO_BYTES = 2_000_000;

export function isTranscriptionConfigured(): boolean {
  return isOpenAiConfigured();
}

function extensionForMime(mimeType: string): string {
  const mime = mimeType.toLowerCase();
  if (mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac")) return "m4a";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("ogg") || mime.includes("opus")) return "ogg";
  if (mime.includes("wav")) return "wav";
  return "webm";
}

export function decodeAudioBase64(audioBase64: string): Buffer {
  const cleaned = audioBase64.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
  return Buffer.from(cleaned, "base64");
}

/**
 * Transcribe a field-capture recording with OpenAI gpt-4o-transcribe.
 * The model only produces text; it does not geocode.
 */
export async function transcribeCaptureAudio(
  audio: Buffer,
  mimeType: string
): Promise<string> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error("Speech transcription is not configured.");
  }
  if (audio.length === 0) {
    throw new Error("Recording was empty.");
  }
  if (audio.length > MAX_CAPTURE_AUDIO_BYTES) {
    throw new Error("Recording is too large. Try a shorter take.");
  }

  const ext = extensionForMime(mimeType || "audio/webm");
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(audio)], { type: mimeType || "audio/webm" }),
    `capture.${ext}`
  );
  form.append("model", "gpt-4o-transcribe");
  form.append("language", "en");
  form.append(
    "prompt",
    "A list of South Bend Indiana street addresses for parcel delivery. Include the word express when the speaker says it."
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn("[capture:transcribe] OpenAI HTTP", response.status, detail.slice(0, 180));
      throw new Error("We couldn't transcribe that recording. Try again or paste the addresses.");
    }
    const json = (await response.json()) as { text?: string };
    const text = typeof json.text === "string" ? json.text.replace(/\s+/g, " ").trim() : "";
    if (!text) {
      throw new Error("We didn't catch any addresses in that recording.");
    }
    return text;
  } catch (err) {
    if (err instanceof Error && /couldn't transcribe|didn't catch/i.test(err.message)) throw err;
    console.warn("[capture:transcribe] failed", err instanceof Error ? err.message : err);
    throw new Error("We couldn't transcribe that recording. Try again or paste the addresses.");
  } finally {
    clearTimeout(timer);
  }
}
