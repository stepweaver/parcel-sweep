import type { CarrierDispatch } from "../types/carrierJournal";
import {
  getCarrierLevel,
  getCarrierMilestones,
  getCarrierRankLadder,
  type CarrierMilestone,
  type CarrierMilestoneTier,
  type CarrierRank,
} from "../lib/carrierMilestones";

const ICON_CHARS: Record<string, string> = {
  activity: "◎",
  award: "★",
  calendar: "▦",
  "cloud-rain": "☔",
  droplets: "💧",
  flame: "🔥",
  heart: "♥",
  "map-pin": "📍",
  package: "📦",
  shield: "⛨",
  snowflake: "❄",
  sun: "☀",
  thermometer: "🌡",
  zap: "⚡",
};

const TIER_COLOR: Record<CarrierMilestoneTier, string> = {
  basic: "#94a3b8",
  field: "var(--usps-blue)",
  campaign: "#eab308",
  veteran: "#a78bfa",
};

const TIER_LABEL: Record<CarrierMilestoneTier, string> = {
  basic: "BASIC QUALIFICATION",
  field: "FIELD QUALIFICATION",
  campaign: "CAMPAIGN QUALIFICATION",
  veteran: "VETERAN RECORD",
};

function BadgeCard({ badge }: { badge: CarrierMilestone }) {
  const color = badge.unlocked ? TIER_COLOR[badge.tier] : "var(--text-meta)";
  const borderColor = badge.unlocked ? TIER_COLOR[badge.tier] : "var(--border)";

  return (
    <div
      className={`carrier-badge${badge.unlocked ? " carrier-badge--unlocked" : ""}`}
      style={{ borderColor, color }}
      title={badge.description}
    >
      <span className="carrier-badge__icon" aria-hidden="true">
        {ICON_CHARS[badge.icon] ?? "★"}
      </span>
      <span className="carrier-badge__label">{badge.shortLabel}</span>
      {!badge.unlocked && badge.target > 1 && (
        <span className="carrier-badge__progress">
          {badge.progress.toLocaleString()}/{badge.target.toLocaleString()}
        </span>
      )}
    </div>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="carrier-progress">
      <div
        className="carrier-progress__fill"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

function RankLadderHeader() {
  return (
    <div className="carrier-rank-row carrier-rank-row--header">
      <span>LVL</span>
      <span>RANK</span>
      <span className="carrier-rank-row__num">AT</span>
      <span className="carrier-rank-row__num">TO GO</span>
    </div>
  );
}

function RankLadderRow({ rank }: { rank: CarrierRank }) {
  const isCurrent = rank.status === "current";
  const isReached = rank.status === "reached";

  return (
    <div
      className={`carrier-rank-row${isCurrent ? " carrier-rank-row--active" : ""}${rank.status === "locked" ? " carrier-rank-row--locked" : ""}`}
    >
      <span className="carrier-rank-row__lvl">{String(rank.level).padStart(2, "0")}</span>
      <span className="carrier-rank-row__title">
        {rank.title}
        {isCurrent && <span className="carrier-rank-row__active-tag">ACTIVE</span>}
      </span>
      <span className="carrier-rank-row__num">{rank.miles.toLocaleString()} mi</span>
      <span className="carrier-rank-row__num">
        {isReached ? (
          <span className="carrier-rank-row__clear">CLEAR</span>
        ) : isCurrent ? (
          "—"
        ) : (
          `${rank.milesRemaining.toLocaleString()} mi`
        )}
      </span>
    </div>
  );
}

type Props = {
  dispatches: CarrierDispatch[];
};

export function CarrierMilestonePanel({ dispatches }: Props) {
  const level = getCarrierLevel(dispatches);
  const rankLadder = getCarrierRankLadder(level.totalMiles);
  const milestones = getCarrierMilestones(dispatches);
  const unlockedCount = milestones.filter((m) => m.unlocked).length;
  const tierOrder: CarrierMilestoneTier[] = ["basic", "field", "campaign", "veteran"];

  const milesUntilNext =
    level.nextMiles != null
      ? Math.max(0, Math.round((level.nextMiles - level.totalMiles) * 10) / 10)
      : null;

  return (
    <div className="card carrier-milestone-panel">
      <div className="carrier-milestone-panel__header">
        <div>
          <div className="carrier-milestone-panel__eyebrow">
            FIELD QUALIFICATIONS // CARRIER RECORD
          </div>
          <h2 className="carrier-milestone-panel__title">{level.title}</h2>
          <div className="carrier-milestone-panel__level-count">
            LEVEL {level.level} OF {level.totalLevels}
          </div>
        </div>
        <div className="carrier-milestone-panel__quals">
          <div className="carrier-milestone-panel__quals-value">
            {unlockedCount}/{milestones.length}
          </div>
          <div className="carrier-milestone-panel__quals-label">QUALS</div>
        </div>
      </div>

      <div className="carrier-milestone-panel__progress-block">
        <div className="carrier-milestone-panel__progress-meta">
          <span>{level.totalMiles} mi</span>
          {level.nextTitle && milesUntilNext != null && (
            <span>
              {milesUntilNext} mi until {level.nextTitle}
            </span>
          )}
        </div>
        <ProgressBar value={level.progressToNext} />
      </div>

      <div className="carrier-milestone-panel__ladder">
        <div className="carrier-milestone-panel__ladder-title">
          RANK LADDER // {level.totalLevels} LEVELS
        </div>
        <div className="carrier-rank-ladder">
          <RankLadderHeader />
          {rankLadder.map((rank) => (
            <RankLadderRow key={rank.level} rank={rank} />
          ))}
        </div>
      </div>

      {tierOrder.map((tier) => {
        const badges = milestones.filter((m) => m.tier === tier);
        if (badges.length === 0) return null;
        return (
          <div key={tier} className="carrier-tier-group">
            <div className="carrier-tier-group__label" style={{ color: TIER_COLOR[tier] }}>
              {TIER_LABEL[tier]}
            </div>
            <div className="carrier-badge-grid">
              {badges.map((badge) => (
                <BadgeCard key={badge.id} badge={badge} />
              ))}
            </div>
          </div>
        );
      })}

      <div className="carrier-milestone-panel__footer">
        QUALIFICATIONS COMPUTED FROM FIELD DATA
      </div>
    </div>
  );
}
