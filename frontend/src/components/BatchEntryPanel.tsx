import { useMemo } from "react";
import type { AddressSuggestion } from "./AddressAutocomplete";
import type { BatchCountSummary } from "../api";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
import { segmentAddresses } from "../utils/addressSegmenter";
import type { ProbableDuplicate } from "../utils/batchAccounting";
import {
  confirmableCandidates,
  matchInputFor,
  type QuickRouteStop,
} from "../utils/quickRouteStops";

interface BatchEntryPanelProps {
  transcript: string;
  onTranscriptChange: (value: string) => void;
  onAppendFinal: (text: string) => void;
  clearExisting: boolean;
  onClearExistingChange: (value: boolean) => void;
  resolving: boolean;
  onResolve: () => void;
  onCancel: () => void;
  summary: BatchCountSummary | null;
  countError: string;
  resolveError: string;
  filledStops: QuickRouteStop[];
  duplicates: ProbableDuplicate[];
  verifiedExpanded: boolean;
  onVerifiedExpandedChange: (value: boolean) => void;
  onConfirmCandidate: (stopId: string, suggestion: AddressSuggestion) => void;
  onSearchEdit: (stopId: string, text: string) => void;
  onResolveAgain: (stopId: string) => void;
  resolvingStopId: string | null;
  onKeepDuplicate: (stopId: string) => void;
  onRemoveDuplicate: (stopId: string) => void;
}

export function BatchEntryPanel({
  transcript,
  onTranscriptChange,
  onAppendFinal,
  clearExisting,
  onClearExistingChange,
  resolving,
  onResolve,
  onCancel,
  summary,
  countError,
  resolveError,
  filledStops,
  duplicates,
  verifiedExpanded,
  onVerifiedExpandedChange,
  onConfirmCandidate,
  onSearchEdit,
  onResolveAgain,
  resolvingStopId,
  onKeepDuplicate,
  onRemoveDuplicate,
}: BatchEntryPanelProps) {
  const parsedCount = useMemo(() => segmentAddresses(transcript).length, [transcript]);
  const speech = useSpeechRecognition(onAppendFinal);

  const duplicateByStop = useMemo(() => {
    const map = new Map<string, ProbableDuplicate>();
    for (const flag of duplicates) map.set(flag.stopId, flag);
    return map;
  }, [duplicates]);

  const exceptions = filledStops.filter((s) => s.verificationStatus !== "verified");
  const verifiedStops = filledStops.filter((s) => s.verificationStatus === "verified");
  const canResolve = transcript.trim().length > 0 && !resolving;

  return (
    <div className="batch-entry-panel">
      <div className="batch-entry-copy">
        Paste, type, or dictate addresses. Review the transcript, then resolve.
        Say “next address” between stops, or put each address on its own line.
      </div>

      <textarea
        className="batch-entry-transcript"
        value={transcript}
        onChange={(e) => onTranscriptChange(e.target.value)}
        placeholder={"2221 South Olive St\n2107 South Mead St\n1918 W Indiana Ave"}
        autoFocus
        aria-label="Address transcript"
      />

      <div className="batch-entry-speech">
        {speech.supported ? (
          <button
            type="button"
            className={`batch-mic-btn${speech.listening ? " is-listening" : ""}`}
            onClick={() => (speech.listening ? speech.stop() : speech.start())}
            aria-pressed={speech.listening}
            aria-label={speech.listening ? "Stop recording" : "Start recording"}
          >
            {speech.listening ? "Stop" : "Mic"}
          </button>
        ) : (
          <div className="batch-speech-fallback" role="status">
            Browser speech recognition isn't available here. Use your device's keyboard
            dictation or paste addresses instead.
          </div>
        )}
        {speech.listening && (
          <span className="batch-listening-state" role="status">
            Listening… {speech.interim ? speech.interim : "speak an address, then say next address"}
          </span>
        )}
      </div>
      {speech.error && <div className="batch-entry-error">{speech.error}</div>}

      <div className="batch-entry-meta">
        {parsedCount > 0 ? `${parsedCount} address${parsedCount === 1 ? "" : "es"} ready` : "No addresses yet"}
      </div>

      <label className="batch-entry-clear">
        <input
          type="checkbox"
          checked={clearExisting}
          onChange={(e) => onClearExistingChange(e.target.checked)}
        />
        Clear existing stops
      </label>

      <div className="batch-entry-actions">
        <button
          type="button"
          className="btn-primary"
          onClick={onResolve}
          disabled={!canResolve}
        >
          {resolving ? (
            <>
              <span className="spinner" /> Resolving…
            </>
          ) : (
            "Resolve addresses"
          )}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Close
        </button>
      </div>
      <div className="batch-entry-hint">
        {clearExisting ? "This batch will replace the current stop list." : "This batch will be added to the current stop list."}
      </div>

      {(countError || resolveError) && (
        <div className="batch-entry-error" role="alert">
          {countError || resolveError}
        </div>
      )}

      {summary && (
        <div className="batch-summary" role="status">
          <div className="batch-summary-total">{summary.parsed} addresses processed</div>
          <div className="batch-summary-row ok">✓ {summary.verified} Verified</div>
          <div className="batch-summary-row review">! {summary.needsReview} Need review</div>
          <div className="batch-summary-row unresolved">× {summary.unresolved} Unresolved</div>
          <div className="batch-summary-total-line">
            TOTAL = {summary.accountedFor}
            {summary.ok ? "" : " — count mismatch"}
          </div>
        </div>
      )}

      {exceptions.length > 0 && (
        <div className="batch-review-section">
          <div className="batch-review-heading">Needs attention</div>
          {exceptions.map((stop) => {
            const matchInput = matchInputFor(stop);
            const confirmable = confirmableCandidates(stop.reviewCandidates ?? [], matchInput);
            const duplicate = duplicateByStop.get(stop.id);
            return (
              <div key={stop.id} className="batch-exception-card">
                <div className="batch-exception-label">
                  {stop.searchInput || stop.rawInput}
                </div>
                {stop.rawInput && stop.rawInput !== matchInput && (
                  <div className="batch-exception-raw">Original: {stop.rawInput}</div>
                )}
                {stop.verificationStatus === "unresolved" && (
                  <div className="batch-exception-reason">
                    {stop.unresolvedReason ?? "No confident match"}
                  </div>
                )}
                {duplicate && (
                  <div className="batch-duplicate">
                    <span>{duplicate.reason}</span>
                    <div className="batch-duplicate-actions">
                      <button type="button" className="batch-action-btn" onClick={() => onKeepDuplicate(stop.id)}>
                        Keep both
                      </button>
                      <button type="button" className="batch-action-btn" onClick={() => onRemoveDuplicate(stop.id)}>
                        Remove duplicate
                      </button>
                    </div>
                  </div>
                )}
                {confirmable.length > 0 && (
                  <div className="quick-route-review-panel" style={{ marginLeft: 0 }}>
                    <div className="quick-route-review-hint">Choose the correct address:</div>
                    {confirmable.map((candidate) => (
                      <button
                        key={candidate.placeId}
                        type="button"
                        className="quick-route-review-option"
                        onClick={() => onConfirmCandidate(stop.id, candidate)}
                      >
                        {candidate.displayName}
                      </button>
                    ))}
                  </div>
                )}
                <input
                  className="batch-exception-edit"
                  value={stop.address}
                  onChange={(e) => onSearchEdit(stop.id, e.target.value)}
                  aria-label="Edit address to resolve again"
                />
                <button
                  type="button"
                  className="batch-action-btn"
                  onClick={() => onResolveAgain(stop.id)}
                  disabled={resolvingStopId === stop.id}
                >
                  {resolvingStopId === stop.id ? "Resolving…" : "Resolve again"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {verifiedStops.length > 0 && (
        <div className="batch-review-section">
          <button
            type="button"
            className="batch-verified-toggle"
            onClick={() => onVerifiedExpandedChange(!verifiedExpanded)}
            aria-expanded={verifiedExpanded}
          >
            Verified — {verifiedStops.length} address{verifiedStops.length === 1 ? "" : "es"}
            {verifiedExpanded ? " ▾" : " ▸"}
          </button>
          {verifiedExpanded &&
            verifiedStops.map((stop) => (
              <div key={stop.id} className="batch-verified-row">
                {stop.address}
                {stop.rawInput && stop.rawInput !== stop.address && (
                  <div className="batch-exception-raw">Original: {stop.rawInput}</div>
                )}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
