import { useCallback, useEffect, useRef, useState } from "react";

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionErrorLike {
  error: string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isSpeechRecognitionAvailable(): boolean {
  return getSpeechRecognitionCtor() !== null;
}

export function useSpeechRecognition(onFinalTranscript: (text: string) => void): {
  supported: boolean;
  listening: boolean;
  interim: string;
  error: string;
  start: () => void;
  stop: () => void;
} {
  const [supported] = useState(() => isSpeechRecognitionAvailable());
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const wantedRef = useRef(false);
  const onFinalRef = useRef(onFinalTranscript);

  useEffect(() => {
    onFinalRef.current = onFinalTranscript;
  }, [onFinalTranscript]);

  const stop = useCallback(() => {
    wantedRef.current = false;
    setListening(false);
    setInterim("");
    try {
      recognitionRef.current?.stop();
    } catch {
      // already stopped
    }
  }, []);

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setError("Browser speech recognition isn't available here. Use your device's keyboard dictation or paste addresses instead.");
      return;
    }
    setError("");
    wantedRef.current = true;

    try {
      recognitionRef.current?.abort();
    } catch {
      // replace any previous session
    }

    const rec = new Ctor();
    recognitionRef.current = rec;
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (event) => {
      let interimText = "";
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const piece = event.results[i]?.[0]?.transcript ?? "";
        if (event.results[i].isFinal) finalText += piece;
        else interimText += piece;
      }
      setInterim(interimText);
      if (finalText.trim()) {
        onFinalRef.current(finalText);
      }
    };

    rec.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setError("Microphone permission denied. You can still paste or type addresses, or use keyboard dictation.");
        wantedRef.current = false;
        setListening(false);
        return;
      }
      if (event.error === "no-speech" || event.error === "aborted") {
        return;
      }
      setError("Speech recognition error. You can paste or type addresses instead.");
    };

    rec.onend = () => {
      setInterim("");
      if (wantedRef.current) {
        try {
          rec.start();
          setListening(true);
        } catch {
          wantedRef.current = false;
          setListening(false);
        }
      } else {
        setListening(false);
      }
    };

    try {
      rec.start();
      setListening(true);
    } catch {
      setError("Could not start speech recognition. Try again, or paste / type addresses.");
      wantedRef.current = false;
      setListening(false);
    }
  }, []);

  useEffect(() => {
    return () => {
      wantedRef.current = false;
      try {
        recognitionRef.current?.abort();
      } catch {
        // ignore
      }
    };
  }, []);

  return { supported, listening, interim, error, start, stop };
}
