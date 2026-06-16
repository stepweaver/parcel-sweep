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
import { FriendlyInput, FriendlyNumberInput } from "../components/FriendlyInput";
import { RouteProposalCard } from "../components/RouteProposalCard";
import { PageShell } from "../components/PageShell";
import {
  DEFAULT_STATION,
  STATIONS,
  SUNDAY_DEFAULTS,
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
  const [assignRouteId, setAssignRouteId] = useState("");
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [importMode, setImportMode] = useState<"generate" | "csv">("csv");
  const [csvText, setCsvText] = useState("");
  const [hubZip, setHubZip] = useState("46614");
  const [dutTime, setDutTime] = useState("09:30");
  const [operationDate, setOperationDate] = useState(new Date().toISOString().slice(0, 10));
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [overridePkgId, setOverridePkgId] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");

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
        sundayMode: true,
        maxPackagesPerRoute: SUNDAY_DEFAULTS.maxPackagesPerRoute,
        maxStopsPerRoute: SUNDAY_DEFAULTS.maxStopsPerRoute,
        maxRouteDurationMinutes: SUNDAY_DEFAULTS.maxRouteDurationMinutes,
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

  const routeLabel = (r: RouteSummary) =>
    r.routeNumber ? `Route ${r.routeNumber} — ${r.driverName}` : r.driverName;

  const activeRoutes = routes.filter((r) => r.status !== "complete");
  const unassignedPackages = packages.filter((p) => !p.assignedRouteId && p.status === "pending");

  const handleDeleteManifest = async () => {
    if (!manifest) return;
    const activeCount = routes.filter((r) => r.status === "in_delivery").length;
    const routeNote = routes.length
      ? `\n\nThis will also delete ${routes.length} route${routes.length === 1 ? "" : "s"}.`
      : "";
    const activeNote = activeCount
      ? `\n\nWarning: ${activeCount} route${activeCount === 1 ? " is" : "s are"} still in delivery.`
      : "";

    if (
      !confirm(
        `Delete this manifest (ZIP ${manifest.zipCode}, ${manifest.totalPackages} packages)?${routeNote}${activeNote}\n\nThis cannot be undone.`
      )
    ) {
      return;
    }

    setDeleting(true);
    try {
      await api.manifests.delete(manifest.id);
      navigate("/");
    } catch (e) {
      alert(`Error: ${(e as Error).message}`);
      setDeleting(false);
    }
  };

  const handleAssignPackages = async (packageIds: string[], key: string) => {
    if (!manifest || !assignRouteId) return;
    setAssigningId(key);
    try {
      await api.routes.assignPackages(assignRouteId, packageIds);
      await refreshManifest(manifest.id);
    } catch (e) {
      alert(`Error: ${(e as Error).message}`);
    } finally {
      setAssigningId(null);
    }
  };

  const handleImportCsv = async () => {
    if (!csvText.trim()) return;
    setImporting(true);
    setImportError(null);
    try {
      const { manifest: m, packages: p } = await api.manifests.importCsv({
        csv: csvText,
        hubZip,
        hubId: stationId === "custom" ? "custom" : stationId,
        operationDate,
        dutTime,
      });
      navigate(`/manifests/${m.id}`);
      setManifest(m);
      setPackages(p);
    } catch (e) {
      setImportError((e as Error).message);
    } finally {
      setImporting(false);
    }
  };

  const handleCsvFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result ?? ""));
    reader.readAsText(file);
  };

  const handleOverride = async (packageId: string) => {
    if (!manifest || !overrideReason.trim()) return;
    try {
      const { package: updated } = await api.manifests.overridePackage(
        manifest.id,
        packageId,
        overrideReason.trim()
      );
      setPackages((prev) => prev.map((p) => (p.id === packageId ? updated : p)));
      setOverridePkgId(null);
      setOverrideReason("");
    } catch (e) {
      alert(`Override failed: ${(e as Error).message}`);
    }
  };

  const validationStatusLabel = (status?: string) => {
    switch (status) {
      case "verified": return "VERIFIED";
      case "warning": return "REVIEW";
      case "hold": return "HOLD";
      case "duplicate": return "DUPLICATE";
      default: return status?.toUpperCase() ?? "—";
    }
  };

  if (isNew) {
    return (
      <PageShell
        title="Manifest Intake"
        documentTitle="Manifest Intake"
        backLink={<Link to="/">← Dashboard</Link>}
      >

        <div style={{ display: "flex", gap: ".5rem", marginBottom: "1rem" }}>
          <button
            className={importMode === "csv" ? "btn-primary" : "btn-ghost"}
            onClick={() => setImportMode("csv")}
          >
            CSV Import
          </button>
          <button
            className={importMode === "generate" ? "btn-primary" : "btn-ghost"}
            onClick={() => setImportMode("generate")}
          >
            Synthetic (OSM)
          </button>
        </div>

        {importMode === "csv" ? (
          <div className="card" style={{ maxWidth: 720 }}>
            <h2 className="panel-title" style={{ marginBottom: "1rem" }}>Upload Sunday manifest</h2>

            <div className="grid-2" style={{ marginBottom: ".75rem" }}>
              <label>
                <div style={{ fontWeight: 600, marginBottom: ".25rem" }}>Hub ZIP</div>
                <FriendlyInput
                  type="text"
                  inputMode="numeric"
                  value={hubZip}
                  onChange={(e) => setHubZip(e.target.value.replace(/\D/g, "").slice(0, 5))}
                  maxLength={5}
                />
              </label>
              <label>
                <div style={{ fontWeight: 600, marginBottom: ".25rem" }}>DUT (Distribution Up Time)</div>
                <FriendlyInput type="time" value={dutTime} onChange={(e) => setDutTime(e.target.value)} />
              </label>
            </div>

            <label style={{ display: "block", marginBottom: ".75rem" }}>
              <div style={{ fontWeight: 600, marginBottom: ".25rem" }}>Operation date</div>
              <FriendlyInput type="date" value={operationDate} onChange={(e) => setOperationDate(e.target.value)} />
            </label>

            <label style={{ display: "block", marginBottom: ".75rem" }}>
              <div style={{ fontWeight: 600, marginBottom: ".25rem" }}>CSV file</div>
              <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && handleCsvFile(e.target.files[0])} />
            </label>

            <textarea
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              placeholder="Or paste CSV content here…"
              rows={8}
              style={{ width: "100%", fontFamily: "monospace", fontSize: ".8rem", marginBottom: ".75rem" }}
            />

            <div style={{ display: "flex", gap: ".75rem", alignItems: "center", flexWrap: "wrap" }}>
              <a href={api.manifests.importTemplateUrl()} download="manifest-template.csv" className="btn-ghost">
                Download template
              </a>
              <button
                className="btn-primary"
                onClick={() => void handleImportCsv()}
                disabled={importing || !csvText.trim() || hubZip.length !== 5}
              >
                {importing ? <><span className="spinner" /> Importing…</> : "Import & validate"}
              </button>
            </div>

            {importError && (
              <div style={{ color: "#dc2626", marginTop: ".75rem", fontSize: ".9rem" }}>{importError}</div>
            )}
          </div>
        ) : (
        <div className="card" style={{ maxWidth: 480 }}>
          <h2 className="panel-title" style={{ marginBottom: "1rem" }}>
            Fetch real addresses from OpenStreetMap
          </h2>

          <label style={{ display: "block", marginBottom: ".75rem" }}>
            <div style={{ fontWeight: 600, marginBottom: ".25rem" }}>ZIP Code</div>
            <FriendlyInput
              type="text"
              inputMode="numeric"
              value={zipCode}
              onChange={(e) => setZipCode(e.target.value.replace(/\D/g, "").slice(0, 5))}
              placeholder="5-digit ZIP"
              maxLength={5}
            />
          </label>

          <label style={{ display: "block", marginBottom: "1rem" }}>
            <div style={{ fontWeight: 600, marginBottom: ".25rem" }}>Number of Packages (1–200)</div>
            <FriendlyNumberInput
              value={count}
              min={1}
              max={200}
              onChange={setCount}
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
        )}
      </PageShell>
    );
  }

  if (loading) {
    return (
      <PageShell title="Manifest Review" documentTitle="Manifest Review">
        <span className="spinner" /> Loading…
      </PageShell>
    );
  }
  if (error) {
    return (
      <PageShell title="Manifest Review" documentTitle="Manifest Review">
        <div style={{ color: "#dc2626" }}>Error: {error}</div>
      </PageShell>
    );
  }
  if (!manifest) return null;

  const pendingCount = packages.filter((p) => p.status === "pending").length;
  const loadedCount = packages.filter((p) => ["loaded", "in_route"].includes(p.status)).length;
  const deliveredCount = packages.filter((p) => p.status === "delivered").length;
  const assignedCount = packages.filter((p) => p.assignedRouteId).length;
  const unassignedCount = packages.length - assignedCount;
  const heldPackages = packages.filter(
    (p) => p.quarantineStatus === "hold" || p.validationStatus === "hold" || p.validationStatus === "duplicate"
  );
  const reviewPackages = packages.filter(
    (p) => p.validationStatus && p.validationStatus !== "verified"
  );

  return (
    <PageShell
      title={`Manifest Review — ZIP ${manifest.zipCode}`}
      documentTitle="Manifest Review"
      backLink={<Link to="/">← Dashboard</Link>}
      subtitle={
        <>
          {new Date(manifest.generatedAt).toLocaleString()} · {manifest.totalPackages} packages
          {manifest.source === "csv" && " · CSV import"}
          {manifest.dutTime && ` · DUT ${manifest.dutTime}`}
          {routes.length > 0 && ` · ${routes.length} route${routes.length === 1 ? "" : "s"}`}
        </>
      }
      actions={
        <button
          className="btn-ghost"
          style={{ color: "#dc2626" }}
          disabled={deleting}
          onClick={() => void handleDeleteManifest()}
        >
          {deleting ? "Deleting…" : "Delete manifest"}
        </button>
      }
    >

      <datalist id="proposal-driver-suggestions">
        {getRecentDrivers().map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>

      {(heldPackages.length > 0 || reviewPackages.length > 0) && (
        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <h2 className="panel-title" style={{ marginBottom: ".5rem" }}>Validation results</h2>
          <p className="text-muted" style={{ fontSize: ".85rem", marginBottom: "1rem" }}>
            {heldPackages.length} on hold · resolve or override before routing held rows
          </p>
          <div className="manifest-review-table" style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Tracking</th>
                  <th>Address</th>
                  <th>Status</th>
                  <th>Hazmat</th>
                  <th>Oversize</th>
                  <th>Sunday</th>
                  <th>Reasons</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {reviewPackages.map((p) => (
                  <tr key={p.id} className={p.quarantineStatus === "hold" ? "row-hold" : ""}>
                    <td className="mono">{p.trackingNumber.slice(-8)}</td>
                    <td>{p.address}{p.addressLine2 ? ` ${p.addressLine2}` : ""}</td>
                    <td>{validationStatusLabel(p.validationStatus)}</td>
                    <td>{p.hazmatFlag ? "Yes" : "No"}</td>
                    <td>{p.oversizeFlag ? "Yes" : "No"}</td>
                    <td>{p.sundayEligible === false ? "No" : "Yes"}</td>
                    <td className="text-meta">{(p.validationReasons ?? []).join(", ")}</td>
                    <td>
                      {p.quarantineStatus === "hold" && (
                        <button
                          className="btn-ghost"
                          style={{ fontSize: ".75rem" }}
                          onClick={() => setOverridePkgId(p.id)}
                        >
                          Override
                        </button>
                      )}
                      {p.quarantineStatus === "released" && (
                        <span className="text-meta">Released</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {overridePkgId && (
            <div style={{ marginTop: "1rem", display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
              <FriendlyInput
                type="text"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="Supervisor override reason (required)"
                style={{ flex: "1 1 240px" }}
              />
              <button className="btn-primary" disabled={!overrideReason.trim()} onClick={() => void handleOverride(overridePkgId)}>
                Release hold
              </button>
              <button className="btn-ghost" onClick={() => { setOverridePkgId(null); setOverrideReason(""); }}>Cancel</button>
            </div>
          )}
        </div>
      )}

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

      {routes.length > 0 && unassignedPackages.length > 0 && (
        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <h2 className="panel-title" style={{ marginBottom: ".5rem" }}>
            Unassigned packages ({unassignedPackages.length})
          </h2>
          <p className="text-muted" style={{ fontSize: ".85rem", marginBottom: "1rem" }}>
            New packages on the manifest, or leftovers after route planning. Assign them to an active route and driver.
          </p>

          {activeRoutes.length === 0 ? (
            <div className="text-muted" style={{ fontSize: ".85rem" }}>
              All routes on this manifest are complete — create a new route to assign packages.
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: ".75rem", flexWrap: "wrap", alignItems: "flex-end", marginBottom: "1rem" }}>
                <label style={{ flex: "1 1 220px" }}>
                  <div style={{ fontWeight: 600, marginBottom: ".25rem", fontSize: ".9rem" }}>Assign to route</div>
                  <select
                    value={assignRouteId}
                    onChange={(e) => setAssignRouteId(e.target.value)}
                    style={{ width: "100%" }}
                  >
                    <option value="">Select route…</option>
                    {activeRoutes.map((r) => (
                      <option key={r.id} value={r.id}>{routeLabel(r)}</option>
                    ))}
                  </select>
                </label>
                <button
                  className="btn-primary"
                  disabled={!assignRouteId || assigningId === "all"}
                  onClick={() => void handleAssignPackages(unassignedPackages.map((p) => p.id), "all")}
                >
                  {assigningId === "all" ? "Assigning…" : `Assign all (${unassignedPackages.length})`}
                </button>
              </div>

              <PackageList
                packages={unassignedPackages}
                onScan={assignRouteId ? (pkg) => void handleAssignPackages([pkg.id], pkg.id) : undefined}
                showScanButton={!!assignRouteId}
                scanButtonLabel="Assign"
                emptyMessage="No unassigned packages."
              />
              {assignRouteId && (
                <div className="text-muted" style={{ fontSize: ".82rem", marginTop: ".75rem" }}>
                  Selected route: {routeLabel(activeRoutes.find((r) => r.id === assignRouteId)!)}
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <h2 className="panel-title" style={{ marginBottom: ".5rem" }}>Plan &amp; split routes</h2>
        <p className="text-muted" style={{ fontSize: ".85rem", marginBottom: "1rem" }}>
          Optimize all unassigned packages, then split evenly across the available drivers.
          Sunday caps: {SUNDAY_DEFAULTS.maxPackagesPerRoute} packages · {SUNDAY_DEFAULTS.maxStopsPerRoute} stops · {SUNDAY_DEFAULTS.maxRouteDurationMinutes} min per route.
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
            <FriendlyNumberInput
              value={driverCount}
              min={1}
              max={20}
              onChange={setDriverCount}
            />
          </label>
        </div>

        {stationId === "custom" && (
          <label style={{ display: "block", marginTop: ".75rem" }}>
            <div style={{ fontWeight: 600, marginBottom: ".25rem", fontSize: ".9rem" }}>Custom station address</div>
            <FriendlyInput
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
              Assign drivers — {planResult.summary.proposalCount} proposed route{planResult.summary.proposalCount === 1 ? "" : "s"}
            </h2>
            <div className="text-muted" style={{ fontSize: ".85rem" }}>
              {planResult.summary.totalStops} stops · {planResult.summary.unassignedPackages} unassigned ·{" "}
              {planResult.summary.heldPackages} held · {planResult.summary.idleDrivers} idle drivers ·{" "}
              {planResult.settings.driverCount} driver{planResult.settings.driverCount === 1 ? "" : "s"} ·{" "}
              caps {planResult.settings.maxPackagesPerRoute} pkg / {planResult.settings.maxStopsPerRoute} stops / {planResult.settings.maxRouteDurationMinutes} min
            </div>
            {planResult.settings.effectiveClusterMeters > planResult.settings.clusterMeters && (
              <div className="text-muted" style={{ fontSize: ".82rem", marginTop: ".35rem" }}>
                Cluster radius auto-raised to {planResult.settings.effectiveClusterMeters}m for large manifest.
              </div>
            )}
          </div>
          <div className="proposal-grid">
            {planResult.proposals.map((proposal, idx) => {
              const form = proposalForms[proposal.proposalId] ?? { driverName: "Driver 1", routeNumber: "" };
              return (
                <RouteProposalCard
                  key={proposal.proposalId}
                  proposal={proposal}
                  depot={planResult.start}
                  clusterMeters={planResult.settings.effectiveClusterMeters}
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
    </PageShell>
  );
}
