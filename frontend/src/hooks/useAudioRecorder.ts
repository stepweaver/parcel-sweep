import { useCallback, useEffect, useRef, useState } from "react";

const MAX_MS = 90_000;

const PREFERRED_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  return PREFERRED_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

export function isAudioRecordingAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error("Could not read the recording."));
    reader.readAsDataURL(blob);
  });
}

export function useAudioRecorder(): {
  supported: boolean;
  recording: boolean;
  elapsedMs: number;
  error: string;
  start: () => Promise<void>;
  stop: () => Promise<{ blob: Blob; mimeType: string } | null>;
} {
  const [supported] = useState(() => isAudioRecordingAvailable());
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const stopResolverRef = useRef<((blob: Blob | null) => void) | null>(null);

  const cleanupStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stop = useCallback((): Promise<{ blob: Blob; mimeType: string } | null> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      cleanupStream();
      setRecording(false);
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      stopResolverRef.current = (blob) => {
        const mimeType = recorder.mimeType || pickMimeType() || "audio/webm";
        resolve(blob && blob.size > 0 ? { blob, mimeType } : null);
      };
      try {
        recorder.stop();
      } catch {
        stopResolverRef.current = null;
        cleanupStream();
        setRecording(false);
        resolve(null);
      }
    });
  }, [cleanupStream]);

  const start = useCallback(async () => {
    if (!supported) {
      setError("This browser can't record audio. Paste or type the addresses instead.");
      return;
    }
    setError("");
    chunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        setError("Recording failed. Paste or type the addresses instead.");
        setRecording(false);
        cleanupStream();
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || mimeType || "audio/webm",
        });
        chunksRef.current = [];
        cleanupStream();
        setRecording(false);
        stopResolverRef.current?.(blob);
        stopResolverRef.current = null;
      };
      recorder.start(250);
      setRecording(true);
      setElapsedMs(0);
      const startedAt = Date.now();
      timerRef.current = window.setInterval(() => {
        const elapsed = Date.now() - startedAt;
        setElapsedMs(elapsed);
        if (elapsed >= MAX_MS) {
          void stop();
        }
      }, 200);
    } catch {
      setError("Microphone permission denied. You can still paste or type addresses.");
      cleanupStream();
      setRecording(false);
    }
  }, [cleanupStream, stop, supported]);

  useEffect(() => {
    return () => {
      try {
        recorderRef.current?.stop();
      } catch {
        // ignore
      }
      cleanupStream();
    };
  }, [cleanupStream]);

  return { supported, recording, elapsedMs, error, start, stop };
}
