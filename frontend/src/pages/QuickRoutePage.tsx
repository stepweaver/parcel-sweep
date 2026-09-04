import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type BatchCountSummary, type BatchResolveCandidate, type QuickRouteResponse } from "../api";
import { STATIONS, DEFAULT_STATION } from "../config/operations";
import { QuickRouteMap } from "../components/QuickRouteMap";
import { AddressAutocomplete, type AddressSuggestion } from "../components/AddressAutocomplete";
import { CapturePanel, type CaptureSubmitPayload } from "../components/CapturePanel";
import { ReviewStopList } from "../components/ReviewStopList";
import { googleMapsStopUrl, mapquestFullRouteUrl, wazeStopUrl } from "../utils/navigationLinks";
import { appendTranscript } from "../utils/addressSegmenter";
import {
  detectProbableDuplicates,
  keepDuplicateStop,
  removeDuplicateStop,
  summarizeRouteReadiness,
  summarizeVerificationCounts,
  type ProbableDuplicate,
} from "../utils/batchAccounting";
import {
  applyResolvedBatchEntry,
  applyStopSearchEdit,
  applyStopSuggestion,
  applySuggestedCorrection,
  confirmManualPin,
  adjustManualPin,
  matchInputFor,
  mergeImportedStops,
  migrateSavedStops,
  manualPinMapCenter,
  newStopFromSegment,
  restoreDeletedStop,
  snapshotDeleteStop,
  stopBlocksRoute,
  stopIsFilled,
  toggleStopExpress,
  UNDO_DELETE_MS,
  type DeletedStopSnapshot,
  type QuickRouteStop,
  type VerificationStatus,
} from "../utils/quickRouteStops";
import { ManualPinPicker } from "../components/ManualPinPicker";

type StartMode = "station" | "location" | "custom";

const STORAGE_KEY = "parcel-sweep:quick-route";

interface SavedState {
  stops: unknown[];
  startMode: StartMode;
  stationId: string;
  customAddress: string;
}

function loadSaved(): Partial<SavedState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<SavedState>) : {};
  } catch {
    return {};
  }
}

function saveState(state: SavedState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore quota errors
  }
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} hr`;
  return `${h} hr ${m} min`;
}

/** Build a Google Maps multi-stop URL from the optimized result. */
function buildGoogleMapsUrl(result: QuickRouteResponse): string {
  const points = [
    `${result.start.lat},${result.start.lng}`,
    ...result.route.flatMap((step) => step.stops.map((s) => `${s.lat},${s.lng}`)),
  ];
  return `https://www.google.com/maps/dir/${points.join("/")}`;
}

/** Build a Waze URL for the first stop (Waze doesn't support multi-stop via URL). */
function buildWazeUrl(result: QuickRouteResponse): string {
  const first = result.route[0]?.stops[0];
  if (!first) return "https://waze.com/ul";
  return wazeStopUrl({ lat: first.lat, lng: first.lng, address: first.address });
}

/** Build a MapQuest multi-stop directions URL from the optimized result. */
function buildMapQuestUrl(result: QuickRouteResponse): string {
  return mapquestFullRouteUrl(
    result.start,
    result.route.flatMap((step) => step.stops)
  );
}

/** Build plain-text stop list for clipboard copy. */
function buildTextList(result: QuickRouteResponse): string {
  return [`Start: ${result.start.address}`, ...result.route.map((step) =>
    `${step.sequence}. ${step.stops.map((s) => s.address).join(" + ")}`
  )].join("\n");
}

function toSuggestion(candidate: BatchResolveCandidate): AddressSuggestion {
  return {
    placeId: candidate.placeId,
    displayName: candidate.displayName,
    lat: candidate.lat,
    lng: candidate.lng,
    confidence: candidate.confidence,
    rankReason: candidate.rankReason,
    distanceMeters: candidate.distanceMeters,
    city: candidate.city,
    state: candidate.state,
    zip: candidate.zip,
    houseNumber: candidate.houseNumber,
    street: candidate.street,
  };
}

function toBatchEntry(result: {
  id: string;
  rawInput: string;
  normalizedInput: string;
  status: VerificationStatus;
  candidate?: BatchResolveCandidate;
  candidates?: BatchResolveCandidate[];
  reason?: string;
  verificationMethod?: "provider" | "manual_pin";
  verificationProvider?: string;
  suggestedCorrection?: {
    explanation: string;
    changedComponents: string[];
    candidate: BatchResolveCandidate;
  };
}) {
  return {
    id: result.id,
    rawInput: result.rawInput,
    normalizedInput: result.normalizedInput,
    status: result.status,
    candidate: result.candidate ? toSuggestion(result.candidate) : undefined,
    candidates: result.candidates?.map(toSuggestion),
    reason: result.reason,
    verificationMethod: result.verificationMethod,
    verificationProvider: result.verificationProvider,
    suggestedCorrection: result.suggestedCorrection
      ? {
          explanation: result.suggestedCorrection.explanation,
          changedComponents: result.suggestedCorrection.changedComponents,
          candidate: toSuggestion(result.suggestedCorrection.candidate),
        }
      : undefined,
  };
}

function initialStops(raw: unknown): QuickRouteStop[] {
  return migrateSavedStops(raw).filter(stopIsFilled);
}

const START_MODE_LABEL: Record<StartMode, string> = {
  location: "Current location",
  station: "Home station",
  custom: "Custom address",
};

export function QuickRoutePage() {
  const saved = loadSaved();

  const [stops, setStops] = useState<QuickRouteStop[]>(() => initialStops(saved.stops));
  const [startMode, setStartMode] = useState<StartMode>(saved.startMode ?? "location");
  const [stationId, setStationId] = useState(saved.stationId ?? DEFAULT_STATION.id);
  const [customAddress, setCustomAddress] = useState(saved.customAddress ?? "");
  const [customStartCoords, setCustomStartCoords] = useState<{ lat: number; lng: number } | null>(null);
  const customSelectRef = useRef<string | null>(null);

  // Geolocation
  const [locating, setLocating] = useState(false);
  const [locatedCoords, setLocatedCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locatedLabel, setLocatedLabel] = useState("");
  const [locationError, setLocationError] = useState("");

  // Batch entry panel
  const [batchOpen, setBatchOpen] = useState(() => !migrateSavedStops(saved.stops).some(stopIsFilled));
  const [startOpen, setStartOpen] = useState(false);
  const [editingStopId, setEditingStopId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [clearExisting, setClearExisting] = useState(false);
  const [resolvingBatch, setResolvingBatch] = useState(false);
  const [resolvingStopId, setResolvingStopId] = useState<string | null>(null);
  const [batchSummary, setBatchSummary] = useState<BatchCountSummary | null>(null);
  const [batchCountError, setBatchCountError] = useState("");
  const [batchResolveError, setBatchResolveError] = useState("");
  const [pinStopId, setPinStopId] = useState<string | null>(null);
  const [serverTranscription, setServerTranscription] = useState(false);
  const [undoSnapshot, setUndoSnapshot] = useState<DeletedStopSnapshot | null>(null);
  const undoTimerRef = useRef<number | null>(null);

  // Submission
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<QuickRouteResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const resultRef = useRef<HTMLDivElement>(null);
  const autoLocateAttempted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void api.geocode.captureConfig().then((config) => {
      if (!cancelled) setServerTranscription(config.transcription);
    }).catch(() => {
      if (!cancelled) setServerTranscription(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist to localStorage whenever key state changes
  useEffect(() => {
    saveState({ stops, startMode, stationId, customAddress });
  }, [stops, startMode, stationId, customAddress]);

  const removeStop = useCallback((id: string) => {
    setStops((prev) => {
      const { next, snapshot } = snapshotDeleteStop(prev, id);
      if (snapshot) {
        if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
        setUndoSnapshot(snapshot);
        undoTimerRef.current = window.setTimeout(() => {
          setUndoSnapshot(null);
          undoTimerRef.current = null;
        }, UNDO_DELETE_MS);
      }
      return next;
    });
    setPinStopId((current) => (current === id ? null : current));
    setEditingStopId((current) => (current === id ? null : current));
  }, []);

  const handleUndoDelete = useCallback(() => {
    if (!undoSnapshot) return;
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    setStops((prev) => restoreDeletedStop(prev, undoSnapshot));
    setUndoSnapshot(null);
  }, [undoSnapshot]);

  const handleToggleExpress = useCallback((id: string) => {
    setStops((prev) => prev.map((s) => (s.id === id ? toggleStopExpress(s) : s)));
  }, []);

  const handleConfirmCandidate = useCallback((stopId: string, suggestion: AddressSuggestion) => {
    setStops((prev) =>
      prev.map((s) =>
        s.id === stopId
          ? applyStopSuggestion(s, suggestion, s.rawInput, {
              userConfirmed: true,
              matchInput: matchInputFor(s),
            })
          : s
      )
    );
  }, []);

  const handleAcceptCorrection = useCallback((stopId: string) => {
    setStops((prev) =>
      prev.map((s) =>
        s.id === stopId && s.suggestedCorrection
          ? applySuggestedCorrection(s, s.suggestedCorrection)
          : s
      )
    );
  }, []);

  const handleConfirmManualPin = useCallback(async (stopId: string, lat: number, lng: number) => {
    let reverseLabel: string | undefined;
    try {
      const res = await api.geocode.reverse(lat, lng);
      reverseLabel = res.label || undefined;
    } catch {
      reverseLabel = undefined;
    }
    setStops((prev) =>
      prev.map((s) => {
        if (s.id !== stopId) return s;
        if (s.verificationMethod === "manual_pin" && s.verificationStatus === "verified") {
          return adjustManualPin(s, lat, lng, { reverseLabel });
        }
        return confirmManualPin(s, { stopId, lat, lng }, { reverseLabel });
      })
    );
    setPinStopId(null);
  }, []);

  const handleLocate = useCallback((options?: { silent?: boolean }) => {
    if (!navigator.geolocation) {
      if (!options?.silent) {
        setLocationError("Geolocation is not supported by this browser.");
      }
      return;
    }
    setLocating(true);
    if (!options?.silent) {
      setLocationError("");
      setLocatedCoords(null);
      setLocatedLabel("");
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setLocatedCoords({ lat: latitude, lng: longitude });
        setLocatedLabel(`${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
        setLocating(false);
        setLocationError("");
      },
      (err) => {
        if (!options?.silent) {
          setLocationError(`Could not get location: ${err.message}`);
        }
        setLocating(false);
      },
      { timeout: 10000, maximumAge: 300000 }
    );
  }, []);

  // Acquire location on load for route start (when selected) and autocomplete bias.
  useEffect(() => {
    if (autoLocateAttempted.current || locatedCoords || locating) return;
    if (!navigator.geolocation) return;
    autoLocateAttempted.current = true;
    handleLocate({ silent: true });
  }, [locatedCoords, locating, handleLocate]);

  const handleSearchEdit = useCallback((id: string, text: string) => {
    setStops((prev) => prev.map((s) => (s.id === id ? applyStopSearchEdit(s, text) : s)));
  }, []);

  const handleCapture = useCallback(async (payload: CaptureSubmitPayload) => {
    const hasAudio = Boolean(payload.audioBase64);
    const hasText = Boolean(payload.transcript?.trim());
    if (!hasAudio && !hasText) {
      setBatchResolveError("Add at least one address.");
      return;
    }
    setBatchResolveError("");
    setBatchCountError("");
    setResolvingBatch(true);
    try {
      const res = await api.geocode.capture(payload);
      if (res.transcript) setTranscript(res.transcript);
      const byId = new Map(res.results.map((r) => [r.id, r]));
      const incoming = res.parsed.map((entry) => {
        const stop = newStopFromSegment(
          {
            rawInput: entry.rawInput,
            searchInput: entry.addressInput,
            express: entry.express,
          },
          entry.id
        );
        const result = byId.get(entry.id);
        if (!result) {
          return {
            ...stop,
            unresolvedReason: "Batch processing error: this address was not returned.",
          };
        }
        return applyResolvedBatchEntry(stop, toBatchEntry(result));
      });
      const count = summarizeVerificationCounts(
        res.parsed.length,
        incoming.map((s) => s.verificationStatus)
      );
      setBatchSummary(count);
      if (!count.ok || res.results.length !== res.parsed.length || (res.count && !res.count.ok)) {
        setBatchCountError(
          "Not every address was counted. Route creation stays blocked until this is fixed."
        );
      }
      setStops((prev) => mergeImportedStops(prev, incoming, clearExisting));
      setBatchOpen(false);
      setEditingStopId(null);
    } catch (err) {
      setBatchResolveError(err instanceof Error ? err.message : "We couldn't check those addresses.");
    } finally {
      setResolvingBatch(false);
    }
  }, [clearExisting]);

  const handleResolveAgain = useCallback(async (stopId: string) => {
    const stop = stops.find((s) => s.id === stopId);
    if (!stop) return;
    setResolvingStopId(stopId);
    setBatchResolveError("");
    try {
      const res = await api.geocode.resolveBatch(
        [
          {
            id: stop.id,
            rawInput: stop.rawInput,
            searchInput: matchInputFor(stop),
          },
        ],
        { preferGoogle: true }
      );
      const result = res.results[0];
      if (!result || result.id !== stop.id) {
        setBatchCountError(
          "Not every address was counted. Route creation stays blocked until this is fixed."
        );
        setStops((prev) =>
          prev.map((s) =>
            s.id === stopId
              ? {
                  ...s,
                  verificationStatus: "unresolved" as const,
                  unresolvedReason: "Address service unavailable — try again.",
                }
              : s
          )
        );
        return;
      }
      setStops((prev) =>
        prev.map((s) =>
          s.id === stopId
            ? applyResolvedBatchEntry(s, toBatchEntry(result))
            : s
        )
      );
    } catch {
      setStops((prev) =>
        prev.map((s) =>
          s.id === stopId
            ? {
                ...s,
                verificationStatus: "unresolved" as const,
                unresolvedReason: "Address service unavailable — try again.",
              }
            : s
        )
      );
    } finally {
      setResolvingStopId(null);
    }
  }, [stops]);

  const handleResolveOpenIssues = useCallback(async () => {
    const open = stops.filter(
      (s) => stopIsFilled(s) && (s.verificationStatus === "unresolved" || s.verificationStatus === "needs_review")
    );
    if (open.length === 0) return;
    setResolvingBatch(true);
    setBatchResolveError("");
    try {
      const res = await api.geocode.resolveBatch(
        open.map((s) => ({
          id: s.id,
          rawInput: s.rawInput,
          searchInput: matchInputFor(s),
        })),
        { preferGoogle: true }
      );
      const byId = new Map(res.results.map((r) => [r.id, r]));
      setStops((prev) =>
        prev.map((s) => {
          const result = byId.get(s.id);
          return result ? applyResolvedBatchEntry(s, toBatchEntry(result)) : s;
        })
      );
    } catch {
      setBatchResolveError("We couldn't re-check those addresses.");
    } finally {
      setResolvingBatch(false);
    }
  }, [stops]);

  const handleKeepDuplicate = useCallback((stopId: string) => {
    setStops((prev) => keepDuplicateStop(prev, stopId));
  }, []);

  const handleRemoveDuplicate = useCallback((stopId: string) => {
    setStops((prev) => {
      const next = removeDuplicateStop(prev, stopId);
      return next;
    });
  }, []);

  const handleClearAll = useCallback(() => {
    setStops([]);
    setResult(null);
    setError("");
    setBatchSummary(null);
    setBatchCountError("");
    setBatchResolveError("");
    setTranscript("");
    setPinStopId(null);
    setBatchOpen(true);
    setEditingStopId(null);
    setUndoSnapshot(null);
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
  }, []);

  const selectedStation = STATIONS.find((s) => s.id === stationId) ?? DEFAULT_STATION;

  const customStartBias = locatedCoords ?? undefined;

  const resolvedStartAddress = (() => {
    if (startMode === "station") return selectedStation.address;
    if (startMode === "location") return locatedLabel || "Current Location";
    return customAddress.trim();
  })();

  const resolvedStartCoords =
    startMode === "location"
      ? locatedCoords ?? undefined
      : startMode === "station"
        ? selectedStation.coords
        : customStartCoords ?? undefined;

  const filledStops = stops.filter((s) => stopIsFilled(s));
  const duplicates = useMemo(
    () => detectProbableDuplicates(filledStops),
    [filledStops]
  );
  const readiness = useMemo(() => summarizeRouteReadiness(filledStops), [filledStops]);
  const pinStop = pinStopId ? stops.find((s) => s.id === pinStopId) : undefined;
  const isEmptyFlow = filledStops.length === 0;
  const duplicateByStop = useMemo(() => {
    const map = new Map<string, ProbableDuplicate>();
    for (const flag of duplicates) map.set(flag.stopId, flag);
    return map;
  }, [duplicates]);
  const hasUnverifiedStops = filledStops.some((s) => stopBlocksRoute(s));
  const canSubmit =
    !loading &&
    filledStops.length >= 1 &&
    !hasUnverifiedStops &&
    !batchCountError &&
    resolvedStartAddress.length > 0 &&
    (startMode !== "location" || locatedCoords !== null);

  const startSettled =
    (startMode === "location" && locatedCoords !== null) ||
    startMode === "station" ||
    (startMode === "custom" && customAddress.trim().length > 0);
  const startCompact =
    !startOpen &&
    !locationError &&
    (startMode !== "custom" || customAddress.trim().length > 0);
  const startSummaryLabel =
    startMode === "location"
      ? locatedCoords
        ? "Current location"
        : locating
          ? "Finding your location…"
          : "Location not yet available"
      : startMode === "station"
        ? selectedStation.name
        : customAddress.trim() || "Custom address";

  const handleSubmit = async () => {
    setError("");
    setResult(null);
    setLoading(true);
    try {
      const res = await api.quickRoute.optimize({
        startAddress: resolvedStartAddress,
        startCoords: resolvedStartCoords,
        stops: filledStops.map((s) => ({
          address: s.address.trim(),
          rawInput: s.rawInput,
          lat: s.lat,
          lng: s.lng,
          placeId: s.placeId,
          confidence: s.confidence,
          verificationStatus: s.verificationStatus,
          verificationMethod: s.verificationMethod,
          verificationProvider: s.verificationProvider,
          manualVerifiedAt: s.manualVerifiedAt,
          express: s.express,
        })),
      });
      setResult(res);
      requestAnimationFrame(() => {
        resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't build that route.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopyList = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(buildTextList(result));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback: do nothing
    }
  };

  return (
    <main className="page-container quick-route-page">
      <div className="qr-shell">
        <header className="qr-header">
          <div>
            <h1 className="qr-title">Quick Route</h1>
            <p className="qr-lede">
              Speak a batch of addresses, glance at the review list, then go.
            </p>
          </div>
          {(filledStops.length > 0 || result) && (
            <button type="button" className="qr-text-btn qr-clear-all" onClick={handleClearAll}>
              Clear all
            </button>
          )}
        </header>

        <section className="qr-section qr-start" aria-labelledby="qr-start-label">
          {startCompact ? (
            <div className="qr-start-compact">
              <div>
                <div id="qr-start-label" className="qr-section-label">
                  Starting from
                </div>
                <div className="qr-start-value">
                  {startSettled && <span className="qr-ready-mark" aria-hidden="true">✓</span>}
                  {startSummaryLabel}
                </div>
              </div>
              <button type="button" className="qr-text-btn" onClick={() => setStartOpen(true)}>
                Change
              </button>
            </div>
          ) : (
            <>
              <div className="qr-start-expanded-head">
                <div id="qr-start-label" className="qr-section-label">
                  Starting from
                </div>
                {startSettled && (
                  <button type="button" className="qr-text-btn" onClick={() => setStartOpen(false)}>
                    Done
                  </button>
                )}
              </div>
              <div className="qr-start-chips" role="group" aria-label="Starting point">
                {(["location", "station", "custom"] as StartMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={`qr-start-chip${startMode === mode ? " is-active" : ""}`}
                    onClick={() => setStartMode(mode)}
                    aria-pressed={startMode === mode}
                  >
                    {START_MODE_LABEL[mode]}
                  </button>
                ))}
              </div>

              {startMode === "station" && (
                <select
                  value={stationId}
                  onChange={(e) => setStationId(e.target.value)}
                  aria-label="Home station"
                >
                  {STATIONS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} — {s.address}
                    </option>
                  ))}
                </select>
              )}

              {startMode === "location" && (
                <>
                  <div className="qr-start-location">
                    {locatedCoords ? (
                      <div className="qr-start-value" title={locatedLabel}>
                        <span className="qr-ready-mark" aria-hidden="true">✓</span>
                        Current location
                      </div>
                    ) : (
                      <span className="text-muted">
                        {locating ? "Finding your location…" : "Location not yet available"}
                      </span>
                    )}
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => handleLocate()}
                      disabled={locating}
                    >
                      {locating ? (
                        <>
                          <span className="spinner" /> Finding…
                        </>
                      ) : locatedCoords ? (
                        "Update location"
                      ) : (
                        "Use my location"
                      )}
                    </button>
                  </div>
                  {locationError && (
                    <div className="qr-error" role="alert">
                      {locationError}
                    </div>
                  )}
                </>
              )}

              {startMode === "custom" && (
                <AddressAutocomplete
                  value={customAddress}
                  onChange={(v) => {
                    setCustomAddress(v);
                    if (customSelectRef.current === v) {
                      customSelectRef.current = null;
                      return;
                    }
                    setCustomStartCoords(null);
                  }}
                  onSelect={(suggestion) => {
                    customSelectRef.current = suggestion.displayName;
                    setCustomAddress(suggestion.displayName);
                    if (
                      suggestion.lat !== undefined &&
                      suggestion.lng !== undefined &&
                      Number.isFinite(suggestion.lat) &&
                      Number.isFinite(suggestion.lng) &&
                      !(suggestion.lat === 0 && suggestion.lng === 0)
                    ) {
                      setCustomStartCoords({ lat: suggestion.lat, lng: suggestion.lng });
                    } else {
                      setCustomStartCoords(null);
                    }
                  }}
                  placeholder="Your home address, any city"
                  serviceAreaOnly={false}
                  near={customStartBias}
                  style={{ width: "100%" }}
                />
              )}
            </>
          )}
        </section>

        <section className="qr-section qr-add" aria-labelledby="qr-add-label">
          <h2 id="qr-add-label" className="qr-section-heading">
            Capture
          </h2>
          {isEmptyFlow && (
            <p className="qr-section-copy">
              Dictate the whole list, then review anything that needs a look.
            </p>
          )}

          <CapturePanel
            transcript={transcript}
            onTranscriptChange={setTranscript}
            onAppendFinal={(text) => setTranscript((prev) => appendTranscript(prev, text))}
            clearExisting={clearExisting}
            onClearExistingChange={setClearExisting}
            capturing={resolvingBatch}
            onCapture={(payload) => void handleCapture(payload)}
            collapsed={!batchOpen && !isEmptyFlow}
            onExpand={() => setBatchOpen(true)}
            onCollapse={() => setBatchOpen(false)}
            captureError={batchResolveError}
            hasStops={!isEmptyFlow}
            serverTranscription={serverTranscription}
          />

          {batchCountError && (
            <p className="qr-error" role="alert">
              {batchCountError}
            </p>
          )}


          {filledStops.length > 0 && (
            <>
              <div className="qr-summary" role="status">
                <div className="qr-summary-lead">{readiness.total} address{readiness.total === 1 ? '' : 'es'}</div>
                <div className="qr-summary-line is-ready">
                  <span aria-hidden="true">✓</span> {readiness.providerVerified + readiness.manuallyVerified} verified
                </div>
                {readiness.needsReview > 0 && (
                  <div className="qr-summary-line is-attention">
                    <span aria-hidden="true">!</span> {readiness.needsReview} need{readiness.needsReview === 1 ? 's' : ''} review
                  </div>
                )}
                {readiness.unresolved > 0 && (
                  <div className="qr-summary-line is-unresolved">
                    <span aria-hidden="true">?</span> {readiness.unresolved} unresolved
                  </div>
                )}
                {batchSummary && !batchSummary.ok && (
                  <div className="qr-summary-line is-unresolved">Counted {batchSummary.accountedFor} of {batchSummary.parsed}</div>
                )}
              </div>

              <ReviewStopList
                stops={filledStops}
                editingStopId={editingStopId}
                resolvingStopId={resolvingStopId}
                resolvingAll={resolvingBatch}
                duplicateByStop={duplicateByStop}
                onToggleExpress={handleToggleExpress}
                onDelete={removeStop}
                onStartEdit={(id) => setEditingStopId(id)}
                onEditChange={handleSearchEdit}
                onSubmitEdit={(id) => {
                  setEditingStopId(null);
                  void handleResolveAgain(id);
                }}
                onCancelEdit={() => setEditingStopId(null)}
                onUseSuggestion={handleAcceptCorrection}
                onConfirmCandidate={(id, placeId) => {
                  const stop = stops.find((s) => s.id === id);
                  const candidate = stop?.reviewCandidates?.find((c) => c.placeId === placeId);
                  if (candidate) handleConfirmCandidate(id, candidate);
                }}
                onPin={setPinStopId}
                onResolveAgain={(id) => void handleResolveAgain(id)}
                onKeepDuplicate={handleKeepDuplicate}
                onRemoveDuplicate={handleRemoveDuplicate}
              />

              {readiness.attentionCount > 0 && (
                <button
                  type="button"
                  className="btn-secondary qr-resolve-again"
                  onClick={() => void handleResolveOpenIssues()}
                  disabled={resolvingBatch}
                >
                  {resolvingBatch ? 'Checking…' : 'Resolve Again'}
                </button>
              )}
            </>
          )}

        </section>

        <section className="qr-section qr-cta" aria-labelledby="qr-cta-label">
          {error && (
            <div className="qr-error" role="alert">
              {error}
            </div>
          )}

          <div className="qr-readiness" role="status" id="qr-cta-label">
            {filledStops.length === 0 ? (
              <p>Add a few stops to build a route.</p>
            ) : readiness.readyToRoute ? (
              <p className="qr-readiness-ok">
                <span className="qr-ready-mark" aria-hidden="true">✓</span>
                {readiness.total} stop{readiness.total === 1 ? "" : "s"} ready
              </p>
            ) : (
              <p>
                {readiness.attentionCount} stop{readiness.attentionCount === 1 ? "" : "s"} still need attention
              </p>
            )}
          </div>

          <button
            className="btn-primary qr-create-route"
            disabled={!canSubmit}
            onClick={() => void handleSubmit()}
            aria-describedby="qr-cta-label"
          >
            {loading ? (
              <>
                <span className="spinner" /> Building your route…
              </>
            ) : (
              "Generate Route"
            )}
          </button>
        </section>

        {result && (
          <div className="qr-results" ref={resultRef}>
            <div className="qr-result-stats">
              {[
                { label: "Stops", value: String(result.route.length) },
                { label: "Drive time", value: formatDuration(result.summary.estimatedDriveSeconds) },
                { label: "Distance", value: `${result.summary.estimatedDriveMiles} mi` },
              ].map(({ label, value }) => (
                <div key={label} className="qr-result-stat">
                  <div className="qr-result-stat-value">{value}</div>
                  <div className="qr-result-stat-label">{label}</div>
                </div>
              ))}
            </div>

            <div className="qr-nav-actions">
              <a
                href={buildGoogleMapsUrl(result)}
                target="_blank"
                rel="noopener noreferrer"
                className="qr-nav-link qr-nav-link--gmaps"
              >
                Open in Google Maps
              </a>
              <a
                href={buildWazeUrl(result)}
                target="_blank"
                rel="noopener noreferrer"
                className="qr-nav-link qr-nav-link--waze"
              >
                Open in Waze
              </a>
              <a
                href={buildMapQuestUrl(result)}
                target="_blank"
                rel="noopener noreferrer"
                className="qr-nav-link qr-nav-link--mapquest"
              >
                Open in MapQuest
              </a>
              <button type="button" className="qr-nav-copy" onClick={() => void handleCopyList()}>
                {copied ? "Copied" : "Copy stop list"}
              </button>
            </div>

            <div className="qr-map-wrap">
              <QuickRouteMap result={result} height={340} />
            </div>

            <div className="qr-stop-order">
              <div className="qr-section-label">Your route</div>

              <div className="qr-order-row">
                <div className="qr-order-go" aria-hidden="true">
                  GO
                </div>
                <div>
                  <div className="qr-order-title">Start</div>
                  <div className="text-muted qr-order-sub">{result.start.address}</div>
                </div>
              </div>

              {result.route.map((step, idx) => {
                const mins = Math.round(step.driveSecondsFromPrevious / 60);
                const isLast = idx === result.route.length - 1;
                const stopNavUrl = googleMapsStopUrl({
                  lat: step.stops[0]?.lat ?? 0,
                  lng: step.stops[0]?.lng ?? 0,
                  address: step.stops[0]?.address,
                });
                return (
                  <div
                    key={step.clusterId}
                    className={`qr-order-row${isLast ? " is-last" : ""}`}
                  >
                    <div className="qr-stop-num is-brand" aria-hidden="true">
                      {step.sequence}
                    </div>
                    <div className="qr-order-body">
                      {step.stops.map((s, i) => (
                        <div
                          key={i}
                          className={i === 0 ? "qr-order-title" : "qr-order-sub"}
                        >
                          {s.address}
                          {s.express ? <span className="qr-express-badge">Express</span> : null}
                        </div>
                      ))}
                      {step.alerts.length > 0 && (
                        <div className="qr-order-alert">⚠ {step.alerts.join(" · ")}</div>
                      )}
                    </div>
                    <div className="qr-order-meta">
                      <div className="text-muted">
                        {mins > 0 && <span>{mins} min</span>}
                        {step.driveMilesFromPrevious > 0 && (
                          <div>{step.driveMilesFromPrevious} mi</div>
                        )}
                      </div>
                      <a href={stopNavUrl} target="_blank" rel="noopener noreferrer">
                        Navigate
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>

            <button type="button" className="btn-secondary qr-create-route" onClick={handleClearAll}>
              Plan another route
            </button>
          </div>
        )}
      </div>
      {undoSnapshot && (
        <div className="qr-undo-toast" role="status">
          Stop removed.
          <button type="button" className="qr-text-btn" onClick={handleUndoDelete}>
            Undo
          </button>
        </div>
      )}
      {pinStop && (
        <ManualPinPicker
          addressLabel={matchInputFor(pinStop) || pinStop.rawInput || pinStop.address}
          center={manualPinMapCenter(pinStop, filledStops)}
          initialPin={
            pinStop.verificationMethod === "manual_pin" &&
            pinStop.lat !== undefined &&
            pinStop.lng !== undefined
              ? { lat: pinStop.lat, lng: pinStop.lng }
              : undefined
          }
          onCancel={() => setPinStopId(null)}
          onConfirm={(lat, lng) => void handleConfirmManualPin(pinStop.id, lat, lng)}
        />
      )}
    </main>
  );
}
