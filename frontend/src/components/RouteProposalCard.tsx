import type { RouteProposal } from "../api";
import { ProposalRouteMap } from "./ProposalRouteMap";

interface RouteProposalCardProps {
  proposal: RouteProposal;
  depot: { lat: number; lng: number; address: string };
  clusterMeters?: number;
  index: number;
  total: number;
  driverName: string;
  routeNumber: string;
  onDriverChange: (value: string) => void;
  onRouteNumberChange: (value: string) => void;
  onCreate: () => void;
  creating: boolean;
  created: boolean;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m} min`;
}

export function RouteProposalCard({
  proposal,
  depot,
  clusterMeters,
  index,
  total,
  driverName,
  routeNumber,
  onDriverChange,
  onRouteNumberChange,
  onCreate,
  creating,
  created,
}: RouteProposalCardProps) {
  const totalDrive = proposal.estimatedDriveSeconds + proposal.returnDriveSeconds;
  const totalMiles =
    Math.round((proposal.estimatedDriveMiles + proposal.returnDriveMiles) * 10) / 10;

  return (
    <div className={`card proposal-card${created ? " proposal-card--created" : ""}`}>
      <div className="proposal-card__header">
        <div>
          <div className="proposal-card__label">
            Proposal {index + 1} of {total}
          </div>
          <div className="proposal-card__title">{proposal.label}</div>
        </div>
        {created && <span className="badge badge-delivered">Created</span>}
      </div>

      <div className="proposal-card__stats">
        <div><strong>{proposal.stopCount}</strong> stops</div>
        <div><strong>{proposal.packageCount}</strong> packages</div>
        <div><strong>{formatDuration(totalDrive)}</strong> drive</div>
        <div><strong>{totalMiles}</strong> mi</div>
      </div>

      <details className="proposal-card__details" open>
        <summary>Route path</summary>
        <ProposalRouteMap
          depot={depot}
          proposal={proposal}
          clusterMeters={clusterMeters}
        />
      </details>

      <details className="proposal-card__details">
        <summary>Stop list ({proposal.stops.length})</summary>
        <ol className="proposal-card__stops">
          {proposal.stops.map((stop) => (
            <li key={stop.sequenceNumber}>
              #{stop.sequenceNumber} · {stop.packageIds.length} pkg
              {stop.driveMilesFromPrev > 0 && (
                <span className="text-meta"> · +{stop.driveMilesFromPrev} mi</span>
              )}
            </li>
          ))}
        </ol>
      </details>

      {!created && (
        <div className="proposal-card__form">
          <label>
            <span className="proposal-card__field-label">Route number</span>
            <input
              type="text"
              value={routeNumber}
              onChange={(e) => onRouteNumberChange(e.target.value)}
              placeholder={`e.g. 40${index + 1}`}
            />
          </label>
          <label>
            <span className="proposal-card__field-label">Driver</span>
            <input
              type="text"
              list="proposal-driver-suggestions"
              value={driverName}
              onChange={(e) => onDriverChange(e.target.value)}
            />
          </label>
          <button
            className="btn-primary"
            disabled={creating || !routeNumber.trim() || !driverName.trim()}
            onClick={onCreate}
          >
            {creating ? <><span className="spinner" /> Creating…</> : "Create route →"}
          </button>
        </div>
      )}
    </div>
  );
}
