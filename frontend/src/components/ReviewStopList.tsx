import { confirmableCandidates, matchInputFor, stopLocalityLine, stopStreetLine, type QuickRouteStop } from "../utils/quickRouteStops";
import { friendlyUnresolvedMessage, stopStatusDetail } from "../utils/quickRouteCopy";
import type { ProbableDuplicate } from "../utils/batchAccounting";

interface ReviewStopListProps {
  stops: QuickRouteStop[];
  editingStopId: string | null;
  resolvingStopId: string | null;
  resolvingAll: boolean;
  duplicateByStop: Map<string, ProbableDuplicate>;
  onToggleExpress: (id: string) => void;
  onDelete: (id: string) => void;
  onStartEdit: (id: string) => void;
  onEditChange: (id: string, text: string) => void;
  onSubmitEdit: (id: string) => void;
  onCancelEdit: () => void;
  onUseSuggestion: (id: string) => void;
  onConfirmCandidate: (id: string, placeId: string) => void;
  onPin: (id: string) => void;
  onResolveAgain: (id: string) => void;
  onKeepDuplicate: (id: string) => void;
  onRemoveDuplicate: (id: string) => void;
}

function statusMark(stop: QuickRouteStop): { symbol: string; className: string; label: string } {
  if (stop.verificationStatus === "verified") {
    return { symbol: "✓", className: "is-verified", label: "Verified" };
  }
  if (stop.verificationStatus === "needs_review") {
    return { symbol: "!", className: "is-review", label: "Needs review" };
  }
  return { symbol: "?", className: "is-unresolved", label: "Unresolved" };
}

export function ReviewStopList({
  stops,
  editingStopId,
  resolvingStopId,
  resolvingAll,
  duplicateByStop,
  onToggleExpress,
  onDelete,
  onStartEdit,
  onEditChange,
  onSubmitEdit,
  onCancelEdit,
  onUseSuggestion,
  onConfirmCandidate,
  onPin,
  onResolveAgain,
  onKeepDuplicate,
  onRemoveDuplicate,
}: ReviewStopListProps) {
  if (stops.length === 0) return null;

  return (
    <ol className="qr-review-list">
      {stops.map((stop) => {
        const mark = statusMark(stop);
        const street = stopStreetLine(stop);
        const locality = stopLocalityLine(stop);
        const editing = editingStopId === stop.id;
        const matchInput = matchInputFor(stop);
        const confirmable = confirmableCandidates(stop.reviewCandidates ?? [], matchInput);
        const duplicate = duplicateByStop.get(stop.id);
        const busy = resolvingStopId === stop.id || resolvingAll;

        return (
          <li key={stop.id} className={`qr-review-row ${mark.className}`}>
            <div className="qr-review-main">
              <span className={`qr-review-mark ${mark.className}`} title={mark.label} aria-label={mark.label}>
                {mark.symbol}
              </span>
              <div className="qr-review-copy">
                {editing ? (
                  <form
                    className="qr-review-edit"
                    onSubmit={(e) => {
                      e.preventDefault();
                      onSubmitEdit(stop.id);
                    }}
                  >
                    <input
                      type="text"
                      value={stop.searchInput ?? stop.address}
                      onChange={(e) => onEditChange(stop.id, e.target.value)}
                      aria-label="Edit address"
                      autoFocus
                    />
                    <button type="submit" className="qr-action-btn qr-action-btn--primary" disabled={busy}>
                      {busy ? "Checking…" : "Check"}
                    </button>
                    <button type="button" className="qr-text-btn" onClick={onCancelEdit}>
                      Cancel
                    </button>
                  </form>
                ) : (
                  <>
                    <div className="qr-review-street">{street}</div>
                    {locality && <div className="qr-review-locality">{locality}</div>}
                    {stop.verificationStatus === "needs_review" && stop.suggestedCorrection && (
                      <div className="qr-review-suggest">
                        Suggested: {stop.suggestedCorrection.candidate.displayName.split(",")[0]}
                      </div>
                    )}
                    {stop.verificationStatus === "unresolved" && (
                      <div className="qr-review-help">{friendlyUnresolvedMessage(stop.unresolvedReason)}</div>
                    )}
                    {stop.verificationStatus === "needs_review" &&
                      !stop.suggestedCorrection &&
                      confirmable.length === 0 && (
                        <div className="qr-review-help">{stopStatusDetail(stop)}</div>
                      )}
                  </>
                )}
              </div>
            </div>

            <div className="qr-review-tools">
              <button
                type="button"
                className={`qr-express-toggle${stop.express ? " is-on" : ""}`}
                aria-pressed={stop.express}
                onClick={() => onToggleExpress(stop.id)}
              >
                Express {stop.express ? "●" : "○"}
              </button>
              {!editing && (
                <button type="button" className="qr-text-btn" onClick={() => onStartEdit(stop.id)}>
                  Edit
                </button>
              )}
              <button type="button" className="qr-text-btn" onClick={() => onDelete(stop.id)}>
                Delete
              </button>
            </div>

            {stop.suggestedCorrection && !editing && (
              <div className="qr-review-actions">
                <button
                  type="button"
                  className="qr-action-btn qr-action-btn--primary"
                  onClick={() => onUseSuggestion(stop.id)}
                >
                  Use suggestion
                </button>
              </div>
            )}
            {confirmable.length > 0 && !stop.suggestedCorrection && !editing && (
              <div className="qr-review-actions">
                {confirmable.map((candidate) => (
                  <button
                    key={candidate.placeId}
                    type="button"
                    className="qr-candidate-btn"
                    onClick={() => onConfirmCandidate(stop.id, candidate.placeId)}
                  >
                    <span className="qr-candidate-name">{candidate.displayName}</span>
                    <span>Yes, use this</span>
                  </button>
                ))}
              </div>
            )}
            {(stop.verificationStatus === "unresolved" ||
              (stop.verificationStatus === "needs_review" && !stop.suggestedCorrection)) &&
              !editing && (
                <div className="qr-review-actions">
                  <button
                    type="button"
                    className="qr-action-btn"
                    onClick={() => onResolveAgain(stop.id)}
                    disabled={busy}
                  >
                    {busy ? "Checking…" : "Try again"}
                  </button>
                  <button
                    type="button"
                    className="qr-action-btn qr-action-btn--primary"
                    onClick={() => onPin(stop.id)}
                  >
                    Pin on map
                  </button>
                </div>
              )}
            {duplicate && (
              <div className="qr-duplicate">
                <p>You may have added this stop twice.</p>
                <div className="batch-duplicate-actions">
                  <button type="button" className="batch-action-btn" onClick={() => onKeepDuplicate(stop.id)}>
                    Keep both
                  </button>
                  <button type="button" className="batch-action-btn" onClick={() => onRemoveDuplicate(stop.id)}>
                    Remove one
                  </button>
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
