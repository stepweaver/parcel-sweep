import { useMemo, useState } from "react";
import { blobToBase64, useAudioRecorder } from "../hooks/useAudioRecorder";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
import { segmentAddresses } from "../utils/addressSegmenter";

export interface CaptureSubmitPayload {
  transcript?: string;
  audioBase64?: string;
  audioMimeType?: string;
}

interface CapturePanelProps {
  transcript: string;
  onTranscriptChange: (value: string) => void;
  onAppendFinal: (text: string) => void;
  clearExisting: boolean;
  onClearExistingChange: (value: boolean) => void;
  capturing: boolean;
  onCapture: (payload: CaptureSubmitPayload) => void;
  collapsed: boolean;
  onExpand: () => void;
  onCollapse: () => void;
  captureError: string;
  hasStops: boolean;
  serverTranscription: boolean;
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function CapturePanel({
  transcript,
  onTranscriptChange,
  onAppendFinal,
  clearExisting,
  onClearExistingChange,
  capturing,
  onCapture,
  collapsed,
  onExpand,
  onCollapse,
  captureError,
  hasStops,
  serverTranscription,
}: CapturePanelProps) {
  const parsedCount = useMemo(() => segmentAddresses(transcript).length, [transcript]);
  const recorder = useAudioRecorder();
  const speech = useSpeechRecognition(onAppendFinal);
  const [busyRecord, setBusyRecord] = useState(false);
  const canUseServerRecord = serverTranscription && recorder.supported;
  const canResolve = (transcript.trim().length > 0 || recorder.recording) && !capturing && !busyRecord;

  if (collapsed) {
    return (
      <div className="qr-batch-collapsed">
        <button type="button" className="qr-text-btn" onClick={onExpand}>
          Add more stops
        </button>
      </div>
    );
  }

  const handleDictate = async () => {
    if (canUseServerRecord) {
      if (recorder.recording) {
        setBusyRecord(true);
        try {
          const take = await recorder.stop();
          if (!take) {
            return;
          }
          const audioBase64 = await blobToBase64(take.blob);
          onCapture({ audioBase64, audioMimeType: take.mimeType });
        } finally {
          setBusyRecord(false);
        }
        return;
      }
      await recorder.start();
      return;
    }
    if (speech.listening) {
      speech.stop();
      return;
    }
    speech.start();
  };

  const dictateLabel = (() => {
    if (capturing || busyRecord) return "Working…";
    if (canUseServerRecord) {
      return recorder.recording ? "Stop recording" : "Dictate Addresses";
    }
    if (speech.supported) {
      return speech.listening ? "Stop listening" : "Dictate Addresses";
    }
    return "Dictate Addresses";
  })();

  const dictateDisabled =
    capturing ||
    busyRecord ||
    (!canUseServerRecord && !speech.supported);

  return (
    <div className="batch-entry-panel qr-capture-panel">
      <button
        type="button"
        className={`qr-dictate-btn${recorder.recording || speech.listening ? " is-listening" : ""}`}
        onClick={() => void handleDictate()}
        disabled={dictateDisabled}
        aria-pressed={recorder.recording || speech.listening}
      >
        {dictateLabel}
      </button>

      {canUseServerRecord && recorder.recording && (
        <div className="batch-listening-state" role="status">
          Recording… {formatElapsed(recorder.elapsedMs)} — say the whole list, then stop.
        </div>
      )}
      {!canUseServerRecord && speech.supported && speech.listening && (
        <div className="batch-listening-state" role="status">
          Listening… {speech.interim ? speech.interim : "say the whole list, then stop"}
        </div>
      )}
      {!canUseServerRecord && !speech.supported && (
        <div className="batch-speech-fallback" role="status">
          Voice entry isn’t available here. Paste a list or type one address per line.
        </div>
      )}
      {(recorder.error || speech.error) && (
        <div className="batch-entry-error">{recorder.error || speech.error}</div>
      )}

      <label className="batch-entry-copy" htmlFor="qr-batch-transcript">
        Or paste / type. One address per line is fine; a spoken run works too.
      </label>
      <textarea
        id="qr-batch-transcript"
        className="batch-entry-transcript"
        value={transcript}
        onChange={(e) => onTranscriptChange(e.target.value)}
        placeholder={"2221 South Olive Street\n2107 South Mead Street\n1818 South Jackson Street express"}
        aria-label="Paste or type your addresses"
      />

      <div className="batch-entry-meta">
        {parsedCount > 0
          ? `${parsedCount} address${parsedCount === 1 ? "" : "es"}`
          : "Speak, paste, or type your addresses"}
      </div>

      {hasStops && (
        <label className="batch-entry-clear">
          <input
            type="checkbox"
            checked={clearExisting}
            onChange={(e) => onClearExistingChange(e.target.checked)}
          />
          Replace the stops I already added
        </label>
      )}

      <div className="batch-entry-actions">
        <button
          type="button"
          className="btn-primary"
          onClick={() => onCapture({ transcript })}
          disabled={!canResolve || transcript.trim().length === 0}
        >
          {capturing ? (
            <>
              <span className="spinner" /> Checking addresses…
            </>
          ) : (
            "Check addresses"
          )}
        </button>
        {hasStops && (
          <button type="button" className="btn-secondary" onClick={onCollapse}>
            Done
          </button>
        )}
      </div>

      {captureError && (
        <div className="batch-entry-error" role="alert">
          {captureError}
        </div>
      )}
    </div>
  );
}
