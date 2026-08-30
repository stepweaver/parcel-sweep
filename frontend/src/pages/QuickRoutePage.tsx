import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type BatchCountSummary, type BatchResolveCandidate, type QuickRouteResponse } from "../api";
import { STATIONS, DEFAULT_STATION } from "../config/operations";
import { QUICK_ROUTE_SERVICE_AREA } from "../config/quickRouteServiceArea";
import { QuickRouteMap } from "../components/QuickRouteMap";
import { AddressAutocomplete, type AddressSuggestion } from "../components/AddressAutocomplete";
import { BatchEntryPanel } from "../components/BatchEntryPanel";
import { googleMapsStopUrl, wazeStopUrl } from "../utils/navigationLinks";
import { segmentAddresses, appendTranscript } from "../utils/addressSegmenter";
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
  applyStopTextEdit,
  applySuggestedCorrection,
  confirmableCandidates,
  confirmManualPin,
  adjustManualPin,
  matchInputFor,
  mergeImportedStops,
  migrateSavedStops,
  manualPinMapCenter,
  newStop,
  newStopFromSegment,
  stopAllowsAdjustPin,
  stopAllowsManualPin,
  stopBlocksRoute,
  stopIsFilled,
  type QuickRouteStop,
  type VerificationStatus,
} from "../utils/quickRouteStops";
import {
  diagnosticStatusDetail,
  friendlyUnresolvedMessage,
  stopStatusDetail,
} from "../utils/quickRouteCopy";
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
  const migrated = migrateSavedStops(raw);
  const filled = migrated.filter(stopIsFilled);
  const empty = migrated.find((s) => !stopIsFilled(s));
  if (filled.length === 0) return [empty ?? newStop()];
  return empty ? [...filled, empty] : filled;
}

const START_MODE_LABEL: Record<StartMode, string> = {
  location: "Current location",
  station: "Home station",
  custom: "Custom address",
};

function RemoveStopButton({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="qr-remove-btn"
      title="Remove stop"
      aria-label="Remove stop"
      onClick={onClick}
      disabled={disabled}
    >
      ×
    </button>
  );
}

function DuplicatePrompt({
  onKeep,
  onRemove,
}: {
  onKeep: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="qr-duplicate">
      <p>You may have added this stop twice.</p>
      <div className="batch-duplicate-actions">
        <button type="button" className="batch-action-btn" onClick={onKeep}>
          Keep both
        </button>
        <button type="button" className="batch-action-btn" onClick={onRemove}>
          Remove one
        </button>
      </div>
    </div>
  );
}

/** Exception cards are for checked stops that still need a decision — not live typing. */
function stopShowsAsException(stop: QuickRouteStop): boolean {
  if (!stopIsFilled(stop)) return false;
  if (stop.verificationStatus === "needs_review") return true;
  return stop.verificationStatus === "unresolved" && Boolean(stop.unresolvedReason);
}

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
  const [verifiedExpanded, setVerifiedExpanded] = useState(false);
  const [pinStopId, setPinStopId] = useState<string | null>(null);

  // Submission
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<QuickRouteResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const addStopRef = useRef<HTMLButtonElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const autoLocateAttempted = useRef(false);

  // Persist to localStorage whenever key state changes
  useEffect(() => {
    saveState({ stops, startMode, stationId, customAddress });
  }, [stops, startMode, stationId, customAddress]);

  const registerRef = useCallback((id: string, el: HTMLInputElement | null) => {
    if (el) inputRefs.current.set(id, el);
    else inputRefs.current.delete(id);
  }, []);

  const addStop = useCallback(() => {
    const s = newStop();
    setStops((prev) => [...prev, s]);
    requestAnimationFrame(() => {
      inputRefs.current.get(s.id)?.focus();
    });
  }, []);

  const removeStop = useCallback((id: string) => {
    setStops((prev) => {
      if (prev.length <= 1) return prev;
      const idx = prev.findIndex((s) => s.id === id);
      const next = prev.filter((s) => s.id !== id);
      requestAnimationFrame(() => {
        const target = next[Math.min(idx, next.length - 1)];
        if (target) inputRefs.current.get(target.id)?.focus();
        else addStopRef.current?.focus();
      });
      return next;
    });
  }, []);

  const updateStop = useCallback((id: string, address: string) => {
    setStops((prev) => prev.map((s) => (s.id === id ? applyStopTextEdit(s, address) : s)));
  }, []);

  const handleStopSelect = useCallback((stopId: string, suggestion: AddressSuggestion, rawInput: string) => {
    setStops((prev) => {
      const idx = prev.findIndex((s) => s.id === stopId);
      if (idx < 0) return prev;
      const updated = prev.map((s) =>
        s.id === stopId
          ? applyStopSuggestion(s, suggestion, s.rawInput.trim() ? s.rawInput : rawInput, {
              matchInput: rawInput,
            })
          : s
      );
      const selected = updated[idx];
      if (selected.verificationStatus !== "verified") return updated;
      if (idx === prev.length - 1) {
        const nextStop = newStop();
        requestAnimationFrame(() => {
          inputRefs.current.get(nextStop.id)?.focus();
        });
        return [...updated, nextStop];
      }
      const nextId = updated[idx + 1].id;
      requestAnimationFrame(() => {
        inputRefs.current.get(nextId)?.focus();
      });
      return updated;
    });
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

  const handleSuggestionsChange = useCallback((stopId: string, suggestions: AddressSuggestion[]) => {
    setStops((prev) =>
      prev.map((s) => (s.id === stopId ? { ...s, reviewCandidates: suggestions } : s))
    );
  }, []);

  const handleStopKeyDown = useCallback(
    (e: React.KeyboardEvent, id: string) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const idx = stops.findIndex((s) => s.id === id);
        if (idx === stops.length - 1) {
          addStop();
        } else {
          inputRefs.current.get(stops[idx + 1].id)?.focus();
        }
      } else if (e.key === "Backspace") {
        const stop = stops.find((s) => s.id === id);
        if (stop?.address === "" && stops.length > 1) {
          e.preventDefault();
          removeStop(id);
        }
      }
    },
    [stops, addStop, removeStop]
  );

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

  const handleResolveBatch = useCallback(async () => {
    const segments = segmentAddresses(transcript);
    if (segments.length === 0) {
      setBatchResolveError("Add at least one address.");
      return;
    }
    setBatchResolveError("");
    setBatchCountError("");
    setResolvingBatch(true);
    try {
      const payload = segments.map((segment) => ({
        id: crypto.randomUUID(),
        rawInput: segment.rawInput,
        searchInput: segment.searchInput,
      }));
      const res = await api.geocode.resolveBatch(payload);
      const byId = new Map(res.results.map((r) => [r.id, r]));
      const incoming = payload.map((entry, i) => {
        const stop = newStopFromSegment(segments[i], entry.id);
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
        segments.length,
        incoming.map((s) => s.verificationStatus)
      );
      setBatchSummary(count);
      if (!count.ok || res.results.length !== segments.length || (res.count && !res.count.ok)) {
        setBatchCountError(
          "Not every address was counted. Route creation stays blocked until this is fixed."
        );
      }
      setStops((prev) => mergeImportedStops(prev, incoming, clearExisting));
      setBatchOpen(false);
      setVerifiedExpanded(false);
      setEditingStopId(null);
    } catch (err) {
      setBatchResolveError(err instanceof Error ? err.message : "We couldn't check those addresses.");
    } finally {
      setResolvingBatch(false);
    }
  }, [transcript, clearExisting]);

  const handleResolveAgain = useCallback(async (stopId: string) => {
    const stop = stops.find((s) => s.id === stopId);
    if (!stop) return;
    setResolvingStopId(stopId);
    setBatchResolveError("");
    try {
      const res = await api.geocode.resolveBatch([
        {
          id: stop.id,
          rawInput: stop.rawInput,
          searchInput: matchInputFor(stop),
        },
      ]);
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

  const handleKeepDuplicate = useCallback((stopId: string) => {
    setStops((prev) => keepDuplicateStop(prev, stopId));
  }, []);

  const handleRemoveDuplicate = useCallback((stopId: string) => {
    setStops((prev) => {
      const next = removeDuplicateStop(prev, stopId);
      return next.length > 0 ? next : [newStop()];
    });
  }, []);

  const handleClearAll = useCallback(() => {
    setStops([newStop()]);
    setResult(null);
    setError("");
    setBatchSummary(null);
    setBatchCountError("");
    setBatchResolveError("");
    setTranscript("");
    setPinStopId(null);
    setBatchOpen(true);
    setVerifiedExpanded(false);
    setEditingStopId(null);
  }, []);

  const selectedStation = STATIONS.find((s) => s.id === stationId) ?? DEFAULT_STATION;

  // Prefer the user's location for autocomplete whenever we have it.
  const stopAutocompleteBias =
    locatedCoords ??
    (startMode === "station" ? selectedStation.coords : QUICK_ROUTE_SERVICE_AREA.center);

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
  const attentionStops = filledStops.filter(stopShowsAsException);
  const workingStops = filledStops.filter((s) => !stopShowsAsException(s) && stopBlocksRoute(s));
  const readyStops = filledStops.filter((s) => !stopBlocksRoute(s));
  const emptyStops = stops.filter((s) => !stopIsFilled(s));
  const isEmptyFlow = filledStops.length === 0;
  const readyCount = readiness.providerVerified + readiness.manuallyVerified;
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
              Add your stops. We’ll check the addresses and put them in a good order.
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
            Add stops
          </h2>
          {isEmptyFlow && (
            <p className="qr-section-copy">
              Paste a list, speak them, or add addresses one at a time.
            </p>
          )}

          <BatchEntryPanel
            transcript={transcript}
            onTranscriptChange={setTranscript}
            onAppendFinal={(text) => setTranscript((prev) => appendTranscript(prev, text))}
            clearExisting={clearExisting}
            onClearExistingChange={setClearExisting}
            resolving={resolvingBatch}
            onResolve={() => void handleResolveBatch()}
            collapsed={!batchOpen && !isEmptyFlow}
            onExpand={() => setBatchOpen(true)}
            onCollapse={() => setBatchOpen(false)}
            resolveError={batchResolveError}
            hasStops={!isEmptyFlow}
          />

          {batchCountError && (
            <p className="qr-error" role="alert">
              {batchCountError}
            </p>
          )}

          {filledStops.length > 0 && (
            <div className="qr-summary" role="status">
              {readiness.readyToRoute ? (
                <>
                  <div className="qr-summary-lead">
                    <span className="qr-ready-mark" aria-hidden="true">✓</span>
                    {readiness.total} stop{readiness.total === 1 ? "" : "s"} ready
                  </div>
                  <p>Everything looks good.</p>
                </>
              ) : (
                <>
                  <div className="qr-summary-lead">{readiness.total} stops</div>
                  <div className="qr-summary-line is-ready">
                    <span aria-hidden="true">✓</span> {readyCount} ready
                  </div>
                  <div className="qr-summary-line is-attention">
                    <span aria-hidden="true">!</span> {readiness.attentionCount} need attention
                  </div>
                  <p>
                    Fix {readiness.attentionCount === 1 ? "this stop" : `these ${readiness.attentionCount} stops`} to
                    continue.
                  </p>
                </>
              )}
              <details className="qr-details">
                <summary>Details</summary>
                <ul>
                  <li>{readiness.providerVerified} checked automatically</li>
                  <li>{readiness.manuallyVerified} pinned by you</li>
                  <li>{readiness.needsReview} check this</li>
                  <li>{readiness.unresolved} need a location</li>
                  {batchSummary && (
                    <li>
                      Counted {readiness.accountedFor} of {batchSummary.parsed}
                      {readiness.ok && batchSummary.ok ? "" : " — mismatch"}
                    </li>
                  )}
                </ul>
              </details>
            </div>
          )}

          {attentionStops.length > 0 && (
            <div className="qr-attention">
              <div className="qr-attention-heading">
                Needs attention
                <span className="qr-attention-count">
                  {attentionStops.length} stop{attentionStops.length === 1 ? "" : "s"}
                </span>
              </div>
              {attentionStops.map((stop) => {
                const matchInput = matchInputFor(stop);
                const confirmable = confirmableCandidates(stop.reviewCandidates ?? [], matchInput);
                const duplicate = duplicateByStop.get(stop.id);
                const editing = editingStopId === stop.id;
                const label = stop.searchInput || stop.rawInput || stop.address;
                return (
                  <div key={stop.id} className="qr-exception-card">
                    <div className="qr-exception-head">
                      <div className="qr-exception-address">{label}</div>
                      <RemoveStopButton
                        disabled={stops.length <= 1}
                        onClick={() => removeStop(stop.id)}
                      />
                    </div>
                    {stop.verificationStatus === "unresolved" && (
                      <p className="qr-exception-help">{friendlyUnresolvedMessage(stop.unresolvedReason)}</p>
                    )}
                    {stop.verificationStatus === "needs_review" && confirmable.length === 0 && !stop.suggestedCorrection && (
                      <p className="qr-exception-help">{stopStatusDetail(stop)}</p>
                    )}
                    {stop.suggestedCorrection && (
                      <div className="qr-exception-block">
                        <p className="qr-exception-help">Did you mean:</p>
                        <div className="qr-candidate-name">
                          {stop.suggestedCorrection.candidate.displayName}
                        </div>
                        <button
                          type="button"
                          className="qr-action-btn qr-action-btn--primary"
                          onClick={() => handleAcceptCorrection(stop.id)}
                        >
                          Use this address
                        </button>
                      </div>
                    )}
                    {confirmable.length > 0 && (
                      <div className="qr-exception-block">
                        <p className="qr-exception-help">Is this the right address?</p>
                        {confirmable.map((candidate) => (
                          <button
                            key={candidate.placeId}
                            type="button"
                            className="qr-candidate-btn"
                            onClick={() => handleConfirmCandidate(stop.id, candidate)}
                          >
                            <span className="qr-candidate-name">{candidate.displayName}</span>
                            <span>Yes, use this</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {duplicate && (
                      <DuplicatePrompt
                        onKeep={() => handleKeepDuplicate(stop.id)}
                        onRemove={() => handleRemoveDuplicate(stop.id)}
                      />
                    )}
                    <div className="qr-exception-actions">
                      <button
                        type="button"
                        className="qr-action-btn"
                        onClick={() => void handleResolveAgain(stop.id)}
                        disabled={resolvingStopId === stop.id}
                      >
                        {resolvingStopId === stop.id ? "Checking…" : "Try again"}
                      </button>
                      {stopAllowsManualPin(stop) && (
                        <button
                          type="button"
                          className="qr-action-btn qr-action-btn--primary"
                          onClick={() => setPinStopId(stop.id)}
                        >
                          Pin on map
                        </button>
                      )}
                    </div>
                    {editing ? (
                      <div className="qr-exception-edit">
                        <AddressAutocomplete
                          ref={(el) => registerRef(stop.id, el)}
                          value={stop.address}
                          onChange={(v) => handleSearchEdit(stop.id, v)}
                          onSelect={(suggestion, rawInput) => handleStopSelect(stop.id, suggestion, rawInput)}
                          onSuggestionsChange={(suggestions) => handleSuggestionsChange(stop.id, suggestions)}
                          placeholder="Edit address"
                          near={stopAutocompleteBias}
                          city={QUICK_ROUTE_SERVICE_AREA.city}
                          state={QUICK_ROUTE_SERVICE_AREA.state}
                        />
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="qr-text-btn qr-edit-address"
                        onClick={() => setEditingStopId(stop.id)}
                      >
                        Edit address
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {readyStops.length > 0 && (
            <div className="qr-ready-block">
              {attentionStops.length > 0 ? (
                <button
                  type="button"
                  className="batch-verified-toggle"
                  onClick={() => setVerifiedExpanded(!verifiedExpanded)}
                  aria-expanded={verifiedExpanded}
                >
                  <span className="qr-ready-mark" aria-hidden="true">✓</span>
                  {readyStops.length} stop{readyStops.length === 1 ? "" : "s"} ready
                  <span className="qr-ready-toggle-hint">{verifiedExpanded ? "Hide" : "Show"}</span>
                </button>
              ) : null}
              {(attentionStops.length === 0 || verifiedExpanded) &&
                readyStops.map((stop) => {
                  const idx = stops.findIndex((s) => s.id === stop.id);
                  const duplicate = duplicateByStop.get(stop.id);
                  const pinned = stop.verificationMethod === "manual_pin";
                  const detail = diagnosticStatusDetail(stop);
                  return (
                    <div key={stop.id} className="qr-ready-row-wrap">
                      <div className="qr-ready-row">
                        <div className="qr-stop-num" aria-hidden="true">
                          {idx + 1}
                        </div>
                        <AddressAutocomplete
                          ref={(el) => registerRef(stop.id, el)}
                          value={stop.address}
                          onChange={(v) => updateStop(stop.id, v)}
                          onSelect={(suggestion, rawInput) => handleStopSelect(stop.id, suggestion, rawInput)}
                          onSuggestionsChange={(suggestions) => handleSuggestionsChange(stop.id, suggestions)}
                          onKeyDown={(e) => handleStopKeyDown(e, stop.id)}
                          placeholder={`Address ${idx + 1}`}
                          near={stopAutocompleteBias}
                          city={QUICK_ROUTE_SERVICE_AREA.city}
                          state={QUICK_ROUTE_SERVICE_AREA.state}
                        />
                        <span
                          className={`qr-ready-mark${pinned ? " is-pinned" : ""}`}
                          title={detail ?? "Ready"}
                        >
                          ✓{pinned ? " pinned" : ""}
                        </span>
                        <RemoveStopButton
                          disabled={stops.length <= 1}
                          onClick={() => removeStop(stop.id)}
                        />
                      </div>
                      {stopAllowsAdjustPin(stop) && (
                        <button
                          type="button"
                          className="qr-text-btn"
                          onClick={() => setPinStopId(stop.id)}
                        >
                          Adjust pin
                        </button>
                      )}
                      {duplicate && (
                        <DuplicatePrompt
                          onKeep={() => handleKeepDuplicate(stop.id)}
                          onRemove={() => handleRemoveDuplicate(stop.id)}
                        />
                      )}
                    </div>
                  );
                })}
            </div>
          )}

          <div className="qr-one-at-a-time">
            {!isEmptyFlow && <div className="qr-one-at-a-time-label">or add one at a time</div>}
            <div className="qr-empty-rows">
              {workingStops.map((stop) => {
                const idx = stops.findIndex((s) => s.id === stop.id);
                const duplicate = duplicateByStop.get(stop.id);
                return (
                  <div key={stop.id} className="qr-ready-row-wrap">
                    <div className="qr-empty-row">
                      <div className="qr-stop-num is-empty" aria-hidden="true">
                        {idx + 1}
                      </div>
                      <AddressAutocomplete
                        ref={(el) => registerRef(stop.id, el)}
                        value={stop.address}
                        onChange={(v) => updateStop(stop.id, v)}
                        onSelect={(suggestion, rawInput) => handleStopSelect(stop.id, suggestion, rawInput)}
                        onSuggestionsChange={(suggestions) => handleSuggestionsChange(stop.id, suggestions)}
                        onKeyDown={(e) => handleStopKeyDown(e, stop.id)}
                        placeholder={`Address ${idx + 1}`}
                        near={stopAutocompleteBias}
                        city={QUICK_ROUTE_SERVICE_AREA.city}
                        state={QUICK_ROUTE_SERVICE_AREA.state}
                      />
                      <RemoveStopButton
                        disabled={stops.length <= 1}
                        onClick={() => removeStop(stop.id)}
                      />
                    </div>
                    {stopAllowsManualPin(stop) && (
                      <button
                        type="button"
                        className="qr-text-btn"
                        onClick={() => setPinStopId(stop.id)}
                      >
                        Pin on map
                      </button>
                    )}
                    {duplicate && (
                      <DuplicatePrompt
                        onKeep={() => handleKeepDuplicate(stop.id)}
                        onRemove={() => handleRemoveDuplicate(stop.id)}
                      />
                    )}
                  </div>
                );
              })}
              {emptyStops.map((stop) => {
                const idx = stops.findIndex((s) => s.id === stop.id);
                return (
                  <div key={stop.id} className="qr-empty-row">
                    {!isEmptyFlow && (
                      <div className="qr-stop-num is-empty" aria-hidden="true">
                        {idx + 1}
                      </div>
                    )}
                    <AddressAutocomplete
                      ref={(el) => registerRef(stop.id, el)}
                      value={stop.address}
                      onChange={(v) => updateStop(stop.id, v)}
                      onSelect={(suggestion, rawInput) => handleStopSelect(stop.id, suggestion, rawInput)}
                      onSuggestionsChange={(suggestions) => handleSuggestionsChange(stop.id, suggestions)}
                      onKeyDown={(e) => handleStopKeyDown(e, stop.id)}
                      placeholder={isEmptyFlow ? "Add an address" : `Address ${idx + 1}`}
                      near={stopAutocompleteBias}
                      city={QUICK_ROUTE_SERVICE_AREA.city}
                      state={QUICK_ROUTE_SERVICE_AREA.state}
                    />
                    <RemoveStopButton
                      disabled={stops.length <= 1}
                      onClick={() => removeStop(stop.id)}
                    />
                  </div>
                );
              })}
            </div>
            {!isEmptyFlow && (
              <button
                ref={addStopRef}
                type="button"
                className="qr-add-stop"
                onClick={addStop}
              >
                Add another stop
              </button>
            )}
          </div>
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
              "Create route"
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
