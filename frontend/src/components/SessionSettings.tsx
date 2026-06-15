import { useEffect, useState } from "react";
import { api, type ManifestSummary, type RouteDetail } from "../api";
import {
  DEFAULT_STATION,
  STATIONS,
  getRecentDrivers,
  rememberDriver,
} from "../config/operations";
import { FriendlyInput } from "./FriendlyInput";

interface SessionSettingsProps {
  route: RouteDetail;
  onUpdated: (route: RouteDetail) => void;
}

export function SessionSettings({ route, onUpdated }: SessionSettingsProps) {
  const [driverName, setDriverName] = useState(route.driverName);
  const [stationId, setStationId] = useState(
    STATIONS.find((s) => s.address === route.startAddress)?.id ?? "custom"
  );
  const [customAddress, setCustomAddress] = useState(route.startAddress);
  const [manifestId, setManifestId] = useState(route.manifestId);
  const [manifests, setManifests] = useState<ManifestSummary[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const recentDrivers = getRecentDrivers();
  const selectedStation = STATIONS.find((s) => s.id === stationId);
  const startAddress = stationId === "custom"
    ? customAddress
    : (selectedStation?.address ?? customAddress);

  useEffect(() => {
    setDriverName(route.driverName);
    setStationId(STATIONS.find((s) => s.address === route.startAddress)?.id ?? "custom");
    setCustomAddress(route.startAddress);
    setManifestId(route.manifestId);
  }, [route]);

  useEffect(() => {
    api.manifests.list().then(setManifests).catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await api.routes.update(route.id, {
        driverName: driverName.trim(),
        startAddress: startAddress.trim(),
        manifestId: manifestId !== route.manifestId ? manifestId : undefined,
      });
      rememberDriver(driverName);
      onUpdated(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const manifestChanged = manifestId !== route.manifestId;

  return (
    <div className="card" style={{ marginBottom: "1.5rem" }}>
      <h2 className="panel-title" style={{ marginBottom: "1rem" }}>Session Settings</h2>
      <div className="grid-2" style={{ marginBottom: ".75rem" }}>
        <label>
          <div style={{ fontWeight: 600, marginBottom: ".25rem", fontSize: ".9rem" }}>Loading Dock / Station</div>
          <select
            value={stationId}
            onChange={(e) => setStationId(e.target.value)}
            style={{ width: "100%" }}
          >
            {STATIONS.map((s) => (
              <option key={s.id} value={s.id}>{s.name} — {s.address}</option>
            ))}
            <option value="custom">Custom address…</option>
          </select>
        </label>
        <label>
          <div style={{ fontWeight: 600, marginBottom: ".25rem", fontSize: ".9rem" }}>Driver</div>
          <FriendlyInput
            type="text"
            list="driver-suggestions"
            value={driverName}
            onChange={(e) => setDriverName(e.target.value)}
          />
          <datalist id="driver-suggestions">
            {recentDrivers.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </label>
      </div>

      {stationId === "custom" && (
        <label style={{ display: "block", marginBottom: ".75rem" }}>
          <div style={{ fontWeight: 600, marginBottom: ".25rem", fontSize: ".9rem" }}>Custom station address</div>
          <FriendlyInput
            type="text"
            value={customAddress}
            onChange={(e) => setCustomAddress(e.target.value)}
            placeholder={DEFAULT_STATION.address}
          />
        </label>
      )}

      <label style={{ display: "block", marginBottom: ".75rem" }}>
        <div style={{ fontWeight: 600, marginBottom: ".25rem", fontSize: ".9rem" }}>Manifest</div>
        <select
          value={manifestId}
          onChange={(e) => setManifestId(e.target.value)}
          style={{ width: "100%" }}
        >
          {manifests.map((m) => (
            <option key={m.id} value={m.id}>
              ZIP {m.zipCode} · {m.totalPackages} packages · {new Date(m.generatedAt).toLocaleDateString()}
            </option>
          ))}
        </select>
        {manifestChanged && (
          <div style={{ color: "#92400e", fontSize: ".82rem", marginTop: ".35rem" }}>
            Reassigning clears loaded packages from the current manifest and resets this session.
          </div>
        )}
      </label>

      {error && (
        <div style={{ color: "#dc2626", fontSize: ".85rem", marginBottom: ".75rem" }}>{error}</div>
      )}

      <button
        className="btn-primary"
        disabled={saving || !driverName.trim() || !startAddress.trim()}
        onClick={() => void handleSave()}
      >
        {saving ? <><span className="spinner" /> Saving…</> : saved ? "Saved ✓" : "Save session settings"}
      </button>
    </div>
  );
}
