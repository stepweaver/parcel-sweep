import { useEffect, useRef, type CSSProperties } from "react";

export type AlertLevel = "warning" | "alert" | "arriving" | "nearby";

export interface ActiveAlert {
  level: AlertLevel;
  lines: string[];
  id: string; // unique key so React re-fires on each new alert
}

/** Full-screen blocking arrival alert — requires explicit driver action. */
export interface BlockingAlert {
  id: string;
  clusterId: string;
  level: "arriving";
  lines: string[];
}

// ── Audio ──────────────────────────────────────────────────────────────────

function playTone(
  ctx: AudioContext,
  freqs: number[],
  gap: number,
  volume: number,
  type: OscillatorType = "sine"
) {
  freqs.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime + i * gap);
    gain.gain.setValueAtTime(volume, ctx.currentTime + i * gap);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * gap + gap * 0.85);
    osc.start(ctx.currentTime + i * gap);
    osc.stop(ctx.currentTime + i * gap + gap * 0.85);
  });
}

function playWarning(ctx: AudioContext) {
  // Soft double-ding (G5 → E5)
  playTone(ctx, [784, 659], 0.22, 0.35, "sine");
}
function playAlert(ctx: AudioContext) {
  // Three urgent beeps (A5)
  playTone(ctx, [880, 880, 880], 0.2, 0.55, "triangle");
}
function playArriving(ctx: AudioContext) {
  // Loud siren sweep: low → high × 4
  for (let i = 0; i < 4; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sawtooth";
    const t = ctx.currentTime + i * 0.45;
    osc.frequency.setValueAtTime(440, t);
    osc.frequency.linearRampToValueAtTime(1100, t + 0.4);
    gain.gain.setValueAtTime(0.7, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.43);
    osc.start(t);
    osc.stop(t + 0.43);
  }
}
function playNearby(ctx: AudioContext) {
  // Soft single chime (C6)
  playTone(ctx, [1047, 784], 0.28, 0.3, "sine");
}

// ── Alert overlay components ────────────────────────────────────────────────

const META: Record<AlertLevel, { bg: string; icon: string; label: string; autoDismissMs: number | null }> = {
  warning:  { bg: "#b45309", icon: "📦", label: "APPROACHING",   autoDismissMs: 8000  },
  nearby:   { bg: "#92400e", icon: "⚠",  label: "NEARBY PACKAGE", autoDismissMs: 12000 },
  alert:    { bg: "#b91c1c", icon: "⚠",  label: "NEXT STOP CLOSE", autoDismissMs: 10000 },
  arriving: { bg: "#991b1b", icon: "🚨", label: "ARRIVING NOW",   autoDismissMs: null  },
};

interface AlertBannerProps {
  alert: ActiveAlert | null;
  onDismiss: () => void;
}

export function AlertBanner({ alert, onDismiss }: AlertBannerProps) {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function getCtx() {
    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
    return audioCtxRef.current;
  }

  useEffect(() => {
    if (!alert) return;
    if (timerRef.current) clearTimeout(timerRef.current);

    try {
      const ctx = getCtx();
      void ctx.resume().then(() => {
        if (alert.level === "warning") playWarning(ctx);
        else if (alert.level === "alert") playAlert(ctx);
        else if (alert.level === "nearby") playNearby(ctx);
      });
    } catch { /* audio unavailable */ }

    const meta = META[alert.level];
    if (meta.autoDismissMs !== null) {
      timerRef.current = setTimeout(onDismiss, meta.autoDismissMs);
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [alert?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!alert || alert.level === "arriving") return null;

  const meta = META[alert.level];

  // Non-arriving: compact banner at top (slides down)
  const heightMap: Record<AlertLevel, string> = {
    warning: "auto",
    nearby:  "auto",
    alert:   "auto",
    arriving: "auto",
  };

  return (
    <div
      role="alert"
      style={{
        position: "fixed",
        top: 52, left: 0, right: 0, // below the 52px header bar
        zIndex: 9000,
        background: meta.bg,
        color: "#fff",
        padding: "clamp(.75rem, 3vw, 1.1rem) 1rem",
        display: "flex",
        alignItems: "center",
        gap: "1rem",
        boxShadow: "0 4px 20px rgba(0,0,0,.4)",
        animation: "slideDown .25s ease",
        height: heightMap[alert.level],
      }}
    >
      <span style={{ fontSize: "clamp(1.5rem, 6vw, 2.2rem)", lineHeight: 1, flexShrink: 0 }}>{meta.icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 900, fontSize: "clamp(.85rem, 3.5vw, 1.1rem)", letterSpacing: ".06em", textTransform: "uppercase" }}>
          {meta.label}
        </div>
        {alert.lines.map((l, i) => (
          <div key={i} style={{ fontSize: "clamp(.8rem, 3vw, 1rem)", opacity: .92, marginTop: ".1rem" }}>{l}</div>
        ))}
      </div>
      <button
        onClick={onDismiss}
        aria-label="Dismiss alert"
        style={{
          background: "rgba(255,255,255,.25)", color: "#fff", border: "none",
          borderRadius: 8, padding: ".5rem 1rem", fontWeight: 800,
          fontSize: "clamp(.85rem, 3vw, 1rem)", cursor: "pointer", flexShrink: 0,
          minHeight: 44, minWidth: 44,
        }}
      >
        ✕
      </button>
      <style>{`
        @keyframes slideDown {
          from { transform: translateY(-100%); opacity: 0; }
          to   { transform: translateY(0);     opacity: 1; }
        }
      `}</style>
    </div>
  );
}

const BLOCKING_META = META.arriving;

interface BlockingAlertOverlayProps {
  alert: BlockingAlert | null;
  onAcknowledge: () => void;
  onComplete: () => void;
  onSkip: () => void;
  onSnooze: () => void;
}

export function BlockingAlertOverlay({
  alert,
  onAcknowledge,
  onComplete,
  onSkip,
  onSnooze,
}: BlockingAlertOverlayProps) {
  const audioCtxRef = useRef<AudioContext | null>(null);

  function getCtx() {
    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
    return audioCtxRef.current;
  }

  useEffect(() => {
    if (!alert) return;
    try {
      const ctx = getCtx();
      void ctx.resume().then(() => playArriving(ctx));
    } catch { /* audio unavailable */ }
  }, [alert?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!alert) return null;

  const btnBase: CSSProperties = {
    border: "none",
    borderRadius: 8,
    padding: "clamp(.75rem, 3vw, 1rem) 1rem",
    fontWeight: 800,
    fontSize: "clamp(.9rem, 3.5vw, 1.05rem)",
    cursor: "pointer",
    minHeight: 52,
    width: "100%",
  };

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      style={{
        position: "fixed", inset: 0, zIndex: 10000,
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        background: BLOCKING_META.bg,
        animation: "arrivingFlash 0.6s steps(1) infinite",
        padding: "clamp(1rem, 4vw, 2rem)",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: "5rem", marginBottom: ".5rem" }}>{BLOCKING_META.icon}</div>
      <div style={{ color: "#fff", fontWeight: 900, fontSize: "clamp(2rem, 8vw, 3.5rem)", letterSpacing: ".04em", lineHeight: 1.1, marginBottom: "1rem" }}>
        {BLOCKING_META.label}
      </div>
      {alert.lines.map((l, i) => (
        <div key={i} style={{ color: "#fecaca", fontSize: "clamp(1.1rem, 4vw, 1.5rem)", fontWeight: 700, marginBottom: ".35rem" }}>
          {l}
        </div>
      ))}
      <div style={{
        marginTop: "1.75rem",
        display: "flex",
        flexDirection: "column",
        gap: ".65rem",
        width: "min(100%, 360px)",
      }}>
        <button
          type="button"
          onClick={onAcknowledge}
          style={{ ...btnBase, background: "#fff", color: BLOCKING_META.bg }}
        >
          I'm Here
        </button>
        <button
          type="button"
          onClick={onComplete}
          style={{ ...btnBase, background: "#16a34a", color: "#fff" }}
        >
          Mark Complete
        </button>
        <div style={{ display: "flex", gap: ".65rem" }}>
          <button
            type="button"
            onClick={onSkip}
            style={{ ...btnBase, flex: 1, background: "rgba(255,255,255,.2)", color: "#fff" }}
          >
            Skip
          </button>
          <button
            type="button"
            onClick={onSnooze}
            style={{ ...btnBase, flex: 1, background: "rgba(255,255,255,.2)", color: "#fff" }}
          >
            Remind Me Again
          </button>
        </div>
      </div>
      <style>{`
        @keyframes arrivingFlash {
          0%   { background: ${BLOCKING_META.bg}; }
          50%  { background: #7f1d1d; }
          100% { background: ${BLOCKING_META.bg}; }
        }
      `}</style>
    </div>
  );
}
