import type { ActiveAlert } from "../components/AlertBanner";

const LEVEL_PRIORITY: Record<ActiveAlert["level"], number> = {
  nearby: 1,
  warning: 2,
  alert: 3,
  arriving: 4,
};

/** Request browser notification permission once. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

function vibrateForLevel(level: ActiveAlert["level"]): void {
  if (!("vibrate" in navigator)) return;
  const patterns: Record<ActiveAlert["level"], number | number[]> = {
    warning: [100, 50, 100],
    nearby: 200,
    alert: [150, 80, 150, 80, 150],
    arriving: [300, 100, 300, 100, 300, 100, 500],
  };
  navigator.vibrate(patterns[level]);
}

function speakAlert(alert: ActiveAlert): void {
  if (!("speechSynthesis" in window)) return;
  const text = alert.lines.join(". ");
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = alert.level === "arriving" ? 1.1 : 0.95;
  utterance.pitch = alert.level === "arriving" ? 1.2 : 1;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

let lastNotifiedId: string | null = null;

/** Fire system notification, vibration, and optional speech for a proximity alert. */
export function notifyProximityAlert(alert: ActiveAlert): void {
  if (alert.id === lastNotifiedId) return;
  lastNotifiedId = alert.id;

  vibrateForLevel(alert.level);

  if (alert.level === "arriving" || alert.level === "alert") {
    speakAlert(alert);
  }

  if (!("Notification" in window) || Notification.permission !== "granted") return;

  const titles: Record<ActiveAlert["level"], string> = {
    warning: "Approaching delivery",
    nearby: "Nearby package",
    alert: "Next stop close",
    arriving: "Arriving now",
  };

  try {
    const n = new Notification(titles[alert.level], {
      body: alert.lines.join("\n"),
      tag: `parcel-sweep-${alert.level}`,
      requireInteraction: alert.level === "arriving",
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch { /* unavailable in some contexts */ }
}

export { LEVEL_PRIORITY };
