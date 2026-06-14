import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  api,
  type ManifestSummary,
  type PackageDetail,
  type ProposeRoutesResponse,
  type RouteProposal,
  type RouteSummary,
} from "../api";
import { PackageList } from "../components/PackageList";
import { RouteProposalCard } from "../components/RouteProposalCard";
import {
  DEFAULT_STATION,
  STATIONS,
  getRecentDrivers,
  rememberDriver,
} from "../config/operations";
import { routeHref, routeStatusLabel } from "../utils/routeDisplay";

export function ManifestPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const isNew = id === "new";

  const [zipCode, setZipCode] = useState("46614");
  const [count, setCount] = useState(40);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const [manifest, setManifest] = useState<ManifestSummary | null>(null);
  const [packages, setPackages] = useState<PackageDetail[]>([]);
  const [routes, setRoutes] = useState<RouteSummary[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [error, setError] = useState<string | null>(null);

  const [stationId, setStationId] = useState(DEFAULT_STATION.id);
  const [customAddress, setCustomAddress] = useState("");
  const [driverCount, setDriverCount] = useState(2);
  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planResult, setPlanResult] = useState<ProposeRoutesResponse | null>(null);
  const [createdProposals, setCreatedProposals] = useState<Set<string>>(new Set());
  const [creatingProposalId, setCreatingProposalId] = useState<string | null>(null);
  const [proposalForms, setProposalForms] = useState<
    Record<string, { driverName: string; routeNumber: string }>
  >({});

  const selectedStation = STATIONS.find((s) => s.id === stationId);
  const startAddress = stationId === "custom"
    ? customAddress
    : (selectedStation?.address ?? DEFAULT_STATION.address);

  const refreshManifest = async (manifestId: string) => {
    const [{ manifest: m, packages: p }, r] = await Promise.all([
      api.manifests.get(manifestId),
      api.manifests.routes(manifestId),
    ]);
    setManifest(m);
    setPackages(p);
    setRoutes(r);
  };

  useEffect(() => {
    if (isNew || !id) return;
    refreshManifest(id)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id, isNew]);

  const handleGenerate = async () => {
    setGenerating(true); setGenError(null);
    try {
      const { manifest: m, packages: p } = await api.manifests.generate(zipCode, count);
      navigate(`/manifests/${m.id}`);
      setManifest(m); setPackages(p);
    } catch (e) {
      setGenError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const initProposalForms = (proposals: RouteProposal[]) => {
    const recentDrivers = getRecentDrivers();
    const next: Record<string, { driverName: string; routeNumber: string }> = {};
    proposals.forEach((proposal, idx) => {
      next[proposal.proposalId] = {
        driverName: recentDrivers[idx] ?? recentDrivers[0] ?? "Driver 1",
        routeNumber: "",
      };
    });
    setProposalForms(next);
  };

  const handlePlanRoutes = async () => {
    if (!manifest) return;
    setPlanning(true);
    setPlanError(null);
    setPlanResult(null);
    setCreatedProposals(new Set());
    try {
      const result = await api.manifests.proposeRoutes(manifest.id, {
        startAddress,
        driverCount,
      });
      setPlanResult(result);
      initProposalForms(result.proposals);
    } catch (e) {
      setPlanError((e as Error).message);
    } finally {
      setPlanning(false);
    }
  };

  const handleCreateFromProposal = async (proposal: RouteProposal) => {
    if (!manifest) return;
    const form = proposalForms[proposal.proposalId];
    if (!form?.routeNumber.trim()) return;

    setCreatingProposalId(proposal.proposalId);
    try {
      rememberDriver(form.driverName);
      const created = await api.manifests.createRouteFromProposal(manifest.id, {
        startAddress,
        driverName: form.driverName,
        routeNumber: form.routeNumber.trim(),
        clusterMeters: planResult?.settings.clusterMeters,
        alertMeters: planResult?.settings.alertMeters,
        proposal,
      });
      setCreatedProposals((prev) => new Set(prev).add(proposal.proposalId));
      await refreshManifest(manifest.id);
      navigate(`/routes/${created.id}/load`);
    } catch (e) {
      alert(`Error: ${(e as Error).message}`);
    } finally {
      setCreatingProposalId(null);
    }
  };

  const updateProposalForm = (
    proposalId: string,
    field: "driverName" | "routeNumber",
    value: string
  ) => {
    setProposalForms((prev) => ({
      ...prev,
      [proposalId]: {
        driverName: prev[proposalId]?.driverName ?? "Driver 1",
        routeNumber: prev[proposalId]?.routeNumber ?? "",
        [field]: value,
      },
    }));
  };

  if (isNew) {
    return (
      <div className="page">
        <div className="page-header">
          <Link to="/">← Dashboard</Link>
          <div className="page-title">Generate Manifest</div>
        </div>

        <div className="card" style={{ maxWidth: 480 }}>
          <h2 className="panel-title" style={{ marginBottom: "1rem" }}>
            Fetch real addresses from OpenStreetMap
          </h2>

          <label style={{ display: "block", marginBottom: ".75rem" }}>
            <div style={{ fontWeight: 600, marginBottom: ".25rem" }}>ZIP Code</div>
            <input
              type="text"
              value={zipCode}
              onChange={(e) => setZipCode(e.target.value)}
              placeholder="5-digit ZIP"
              maxLength={5}
            />
          </label>

          <label style={{ display: "block", marginBottom: "1rem" }}>
            <div style={{ fontWeight: 600, marginBottom: ".25rem" }}>Number of Packages (1–200)</div>
            <input
              type="number"
              value={count}
              min={1} max={200}
              onChange={(e) => setCount(Number(e.target.value))}
            />
          </label>

          {genError && (
            <div style={{ color: "#dc2626", marginBottom: ".75rem", fontSize: ".9rem" }}>{genError}</div>
          )}

          <button className="btn-primary" onClick={handleGenerate} disabled={generating || zipCode.length !== 5}>
            {generating ? <><span className="spinner" /> Fetching from OSM…</> : "Generate Manifest"}
          </button>

          <div className="text-muted" style={{ marginTop: "1rem", fontSize: ".82rem" }}>
            Uses the free Overpass / OpenStreetMap API. Generation may take 5–15 seconds.
          </div>
        </div>
      </div>
    );
  }

  if (loading) return <div className="page"><span className="spinner" /> Loading…</div>;
  if (error) return <div className="page" style={{ color: "#dc2626" }}>Error: {error}</div>;
  if (!manifest) return null;

  const pendingCount = packages.filter((p) => p.status === "pending").length;
  const loadedCount = packages.filter((p) => ["loaded", "in_route"].includes(p.status)).length;
  const deliveredCount = packages.filter((p) => p.status === "delivered").length;
  const assignedCount = packages.filter((p) => p.assignedRouteId).length;
  const unassignedCount = packages.length - assignedCount;

  return (
    <div className="page">
      <datalist id="proposal-driver-suggestions">
        {getRecentDrivers().map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>

      <div className="page-header">
        <Link to="/">← Dashboard</Link>
        <div>
          <div className="page-title">Master Manifest — ZIP {manifest.zipCode}</div>
          <div style={{ color: "#6b7280", fontSize: ".85rem" }}>
            {new Date(manifest.generatedAt).toLocaleString()} · {manifest.totalPackages} packages
            {routes.length > 0 && ` · ${routes.length} route${routes.length === 1 ? "" : "s"}`}
          </div>
        </div>
      </div>

      <div className="grid-3" style={{ marginBottom: "1.5rem" }}>
        <div className="card stat-card"><div className="stat-value">{pendingCount}</div><div className="stat-label">Pending</div></div>
        <div className="card stat-card"><div className="stat-value">{loadedCount}</div><div className="stat-label">Loaded</div></div>
        <div className="card stat-card"><div className="stat-value">{deliveredCount}</div><div className="stat-label">Delivered</div></div>
      </div>

      {routes.length > 0 && (
        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <h2 className="panel-title" style={{ marginBottom: "1rem" }}>Routes on this manifest</h2>
          <div>
            {routes.map((r) => (
              <Link key={r.id} to={routeHref(r)} className="list-row">
                <div className="list-row__main">
                  <strong>{r.routeNumber ? `Route ${r.routeNumber}` : r.driverName}</strong>
                  <div className="list-row__sub">{r.driverName} · {r.startAddress}</div>
                </div>
                <div className="list-row__meta">
                  <span className="list-row__status">{routeStatusLabel[r.status] ?? r.status}</span>
                  <div className="list-row__meta-sub">{r.stopCount} stops</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <h2 className="panel-title" style={{ marginBottom: ".5rem" }}>Plan & split routes</h2>
        <p className="text-muted" style={{ fontSize: ".85rem", marginBottom: "1rem" }}>
          Optimize all unassigned packages, then split evenly across the available drivers.
          {assignedCount > 0 && (
            <> {assignedCount} already assigned · {unassignedCount} remaining to plan.</>
          )}
        </p>

        <div className="grid-2">
          <label>
            <div style={{ fontWeight: 600, marginBottom: ".25rem", fontSize: ".9rem" }}>Loading dock / station</div>
            <select value={stationId} onChange={(e) => setStationId(e.target.value)} style={{ width: "100%" }}>
              {STATIONS.map((s) => (
                <option key={s.id} value={s.id}>{s.name} — {s.address}</option>
              ))}
              <option value="custom">Custom address…</option>
            </select>
          </label>
          <label>
            <div style={{ fontWeight: 600, marginBottom: ".25rem", fontSize: ".9rem" }}>Available drivers</div>
            <input
              type="number"
              min={1}
              max={20}
              value={driverCount}
              onChange={(e) => setDriverCount(Math.max(1, Number(e.target.value)))}
            />
          </label>
        </div>

        {stationId === "custom" && (
          <label style={{ display: "block", marginTop: ".75rem" }}>
            <div style={{ fontWeight: 600, marginBottom: ".25rem", fontSize: ".9rem" }}>Custom station address</div>
            <input
              type="text"
              value={customAddress}
              onChange={(e) => setCustomAddress(e.target.value)}
              placeholder={DEFAULT_STATION.address}
            />
          </label>
        )}

        {planError && (
          <div style={{ color: "#dc2626", marginTop: ".75rem", fontSize: ".9rem" }}>{planError}</div>
        )}

        <button
          className="btn-primary"
          style={{ marginTop: "1rem" }}
          onClick={handlePlanRoutes}
          disabled={planning || !startAddress.trim() || unassignedCount === 0 || driverCount < 1}
        >
          {planning ? (
            <><span className="spinner" /> Optimizing manifest…</>
          ) : unassignedCount === 0 ? (
            "All packages assigned"
          ) : (
            `Plan ${driverCount} route${driverCount === 1 ? "" : "s"} →`
          )}
        </button>

        {driverCount > 1 && (
          <div className="text-muted" style={{ marginTop: ".5rem", fontSize: ".82rem" }}>
            Stops are split evenly along the optimized delivery sequence — one route per driver.
          </div>
        )}

        {planning && (
          <div className="text-muted" style={{ marginTop: ".75rem", fontSize: ".82rem" }}>
            Clustering stops and calling OSRM — this may take 10–30 seconds for large manifests.
          </div>
        )}
      </div>

      {planResult && planResult.proposals.length > 0 && (
        <div style={{ marginBottom: "1.5rem" }}>
          <div style={{ marginBottom: "1rem" }}>
            <h2 className="panel-title">
              {planResult.summary.proposalCount} proposed route{planResult.summary.proposalCount === 1 ? "" : "s"}
            </h2>
            <div className="text-muted" style={{ fontSize: ".85rem" }}>
              {planResult.summary.totalStops} stops · {planResult.summary.unassignedPackages} packages ·{" "}
              {planResult.settings.driverCount} driver{planResult.settings.driverCount === 1 ? "" : "s"} ·{" "}
              depot {planResult.start.address}
            </div>
          </div>
          <div className="proposal-grid">
            {planResult.proposals.map((proposal, idx) => {
              const form = proposalForms[proposal.proposalId] ?? { driverName: "Driver 1", routeNumber: "" };
              return (
                <RouteProposalCard
                  key={proposal.proposalId}
                  proposal={proposal}
                  index={idx}
                  total={planResult.proposals.length}
                  driverName={form.driverName}
                  routeNumber={form.routeNumber}
                  onDriverChange={(v) => updateProposalForm(proposal.proposalId, "driverName", v)}
                  onRouteNumberChange={(v) => updateProposalForm(proposal.proposalId, "routeNumber", v)}
                  onCreate={() => void handleCreateFromProposal(proposal)}
                  creating={creatingProposalId === proposal.proposalId}
                  created={createdProposals.has(proposal.proposalId)}
                />
              );
            })}
          </div>
        </div>
      )}

      <div className="card">
        <h2 className="panel-title" style={{ marginBottom: "1rem" }}>All packages</h2>
        <PackageList packages={packages} />
      </div>
    </div>
  );
}
