import { Link } from "react-router-dom";
import type { ManifestSummary, RouteSummary } from "../api";
import { routeHref } from "../utils/routeDisplay";

export interface WorkflowStep {
  id: string;
  label: string;
  status: "pending" | "active" | "complete";
  href?: string;
}

interface WorkflowStepperProps {
  manifests: ManifestSummary[];
  routes: RouteSummary[];
}

function activeManifest(manifests: ManifestSummary[]): ManifestSummary | null {
  const active = manifests.filter((m) => m.status === "active");
  if (active.length === 0) return manifests[0] ?? null;
  return active.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))[0];
}

function firstRoute(
  routes: RouteSummary[],
  predicate: (r: RouteSummary) => boolean,
): RouteSummary | undefined {
  return routes.find(predicate);
}

export function deriveWorkflowSteps(
  manifests: ManifestSummary[],
  routes: RouteSummary[],
): WorkflowStep[] {
  const manifest = activeManifest(manifests);
  const manifestRoutes = manifest
    ? routes.filter((r) => r.manifestId === manifest.id)
    : routes;

  const hasManifest = manifests.length > 0;
  const holdCount = manifest?.validationSummary?.hold ?? 0;
  const duplicateCount = manifest?.validationSummary?.duplicate ?? 0;
  const validationClear = hasManifest && holdCount === 0 && duplicateCount === 0;

  const hasOptimized = manifestRoutes.some((r) => r.status === "optimized" || r.status === "in_delivery" || r.status === "complete");
  const hasRoutes = manifestRoutes.length > 0;
  const driversAssigned = hasRoutes && manifestRoutes.every((r) => r.driverName?.trim());
  const hasLoading = manifestRoutes.some((r) => r.loadedAt);
  const hasDispatch = manifestRoutes.some((r) => r.beginTourAt);
  const hasDelivery = manifestRoutes.some((r) => r.status === "in_delivery");
  const allComplete = hasRoutes && manifestRoutes.every((r) => r.status === "complete");

  const manifestHref = manifest ? `/manifests/${manifest.id}` : "/manifests/new";
  const loadingRoute = firstRoute(manifestRoutes, (r) => r.status === "loading");
  const optimizedRoute = firstRoute(manifestRoutes, (r) => r.status === "optimized");
  const deliveryRoute = firstRoute(manifestRoutes, (r) => r.status === "in_delivery" || r.status === "optimized");

  const steps: Omit<WorkflowStep, "status">[] = [
    { id: "intake", label: "Manifest Intake", href: "/manifests/new" },
    { id: "validation", label: "Address Validation", href: manifestHref },
    { id: "routes", label: "Route Generation", href: manifestHref },
    { id: "drivers", label: "Driver Assignment", href: manifest ? manifestHref : "/admin" },
    { id: "loading", label: "Loading", href: loadingRoute ? `/routes/${loadingRoute.id}/load` : undefined },
    { id: "dispatch", label: "Dispatch", href: optimizedRoute ? `/routes/${optimizedRoute.id}/route` : undefined },
    { id: "delivery", label: "Delivery", href: deliveryRoute ? routeHref(deliveryRoute) : undefined },
    { id: "closeout", label: "Closeout", href: "/sunday" },
  ];

  const completions = [
    hasManifest,
    validationClear,
    hasOptimized,
    driversAssigned,
    hasLoading,
    hasDispatch,
    hasDelivery,
    allComplete,
  ];

  const firstIncomplete = completions.findIndex((c) => !c);

  return steps.map((step, i) => {
    let status: WorkflowStep["status"] = "pending";
    if (completions[i]) status = "complete";
    else if (i === firstIncomplete) status = "active";
    return { ...step, status };
  });
}

export function WorkflowStepper({ manifests, routes }: WorkflowStepperProps) {
  const steps = deriveWorkflowSteps(manifests, routes);

  return (
    <nav className="workflow-stepper card" aria-label="Sunday operations workflow">
      <h2 className="panel-title" style={{ marginBottom: ".75rem" }}>Sunday Workflow</h2>
      <ol className="workflow-stepper__list">
        {steps.map((step) => {
          const content = (
            <>
              <span className="workflow-stepper__marker" aria-hidden="true" />
              <span className="workflow-stepper__label">{step.label}</span>
            </>
          );

          return (
            <li
              key={step.id}
              className={`workflow-stepper__item workflow-stepper__item--${step.status}`}
              aria-current={step.status === "active" ? "step" : undefined}
            >
              {step.href && step.status !== "pending" ? (
                <Link to={step.href} className="workflow-stepper__link">
                  {content}
                </Link>
              ) : (
                <span className="workflow-stepper__link workflow-stepper__link--static">
                  {content}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
