import { useMemo } from "react";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
import { segmentAddresses } from "../utils/addressSegmenter";

interface BatchEntryPanelProps {
  transcript: string;
  onTranscriptChange: (value: string) => void;
  onAppendFinal: (text: string) => void;
  clearExisting: boolean;
  onClearExistingChange: (value: boolean) => void;
  resolving: boolean;
  onResolve: () => void;
  collapsed: boolean;
  onExpand: () => void;
  onCollapse: () => void;
  resolveError: string;
  hasStops: boolean;
}

export function BatchEntryPanel({
  transcript,
  onTranscriptChange,
  onAppendFinal,
  clearExisting,
  onClearExistingChange,
  resolving,
  onResolve,
  collapsed,
  onExpand,
  onCollapse,
  resolveError,
  hasStops,
}: BatchEntryPanelProps) {
  const parsedCount = useMemo(() => segmentAddresses(transcript).length, [transcript]);
  const speech = useSpeechRecognition(onAppendFinal);
  const canResolve = transcript.trim().length > 0 && !resolving;

  if (collapsed) {
    return (
      <div className="qr-batch-collapsed">
        <button type="button" className="qr-text-btn" onClick={onExpand}>
          Add more stops
        </button>
      </div>
    );
  }

  return (
    <div className="batch-entry-panel">
      <label className="batch-entry-copy" htmlFor="qr-batch-transcript">
        Add one address per line, or use the microphone and say “next address” between stops.
      </label>

      <textarea
        id="qr-batch-transcript"
        className="batch-entry-transcript"
        value={transcript}
        onChange={(e) => onTranscriptChange(e.target.value)}
        placeholder={"2221 South Olive St\n2107 South Mead St\n1918 W Indiana Ave"}
        autoFocus
        aria-label="Paste, type, or speak your addresses"
      />

      <div className="batch-entry-speech">
        {speech.supported ? (
          <button
            type="button"
            className={`batch-mic-btn${speech.listening ? " is-listening" : ""}`}
            onClick={() => (speech.listening ? speech.stop() : speech.start())}
            aria-pressed={speech.listening}
            aria-label={speech.listening ? "Stop recording" : "Speak addresses"}
          >
            {speech.listening ? "Stop" : "Speak addresses"}
          </button>
        ) : (
          <div className="batch-speech-fallback" role="status">
            Voice entry isn’t available in this browser. Paste a list or type one address per line.
          </div>
        )}
        {speech.listening && (
          <span className="batch-listening-state" role="status">
            Listening… {speech.interim ? speech.interim : "say an address, then next address"}
          </span>
        )}
      </div>
      {speech.error && <div className="batch-entry-error">{speech.error}</div>}

      <div className="batch-entry-meta">
        {parsedCount > 0
          ? `${parsedCount} address${parsedCount === 1 ? "" : "es"}`
          : "Paste, type, or speak your addresses"}
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
          onClick={onResolve}
          disabled={!canResolve}
        >
          {resolving ? (
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
      {hasStops && (
        <div className="batch-entry-hint">
          {clearExisting
            ? "This list will replace your current stops."
            : "These addresses will be added to your current stops."}
        </div>
      )}

      {resolveError && (
        <div className="batch-entry-error" role="alert">
          {resolveError}
        </div>
      )}
    </div>
  );
}
