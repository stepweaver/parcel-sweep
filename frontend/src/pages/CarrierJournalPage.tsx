import { useEffect, useState } from "react";
import { api, type CarrierDispatch } from "../api";
import { CarrierMilestonePanel } from "../components/CarrierMilestonePanel";
import { PageShell } from "../components/PageShell";

export function CarrierJournalPage() {
  const [dispatches, setDispatches] = useState<CarrierDispatch[]>([]);
  const [source, setSource] = useState<string>("loading");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.carrierJournal
      .dispatches()
      .then(({ dispatches: rows, source: dataSource }) => {
        setDispatches(rows);
        setSource(dataSource);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <PageShell
      title="Carrier's Log"
      subtitle="Field qualifications and walking rank progression"
      documentTitle="Carrier's Log"
    >
      {loading && (
        <p>
          <span className="spinner" /> Loading field record…
        </p>
      )}
      {error && <p style={{ color: "var(--usps-red)" }}>Error: {error}</p>}
      {!loading && !error && source === "unconfigured" && (
        <div className="card" style={{ marginBottom: "1rem", color: "var(--text-muted)" }}>
          Notion is not configured — set <code>NOTION_API_KEY</code> and{" "}
          <code>NOTION_CARRIER_JOURNAL_DB_ID</code> on the backend to load live dispatches.
        </div>
      )}
      {!loading && !error && (
        <CarrierMilestonePanel dispatches={dispatches} />
      )}
    </PageShell>
  );
}
