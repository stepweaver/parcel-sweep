import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import { Dashboard } from "./pages/Dashboard";
import { ManifestPage } from "./pages/ManifestPage";
import { LoadingDock } from "./pages/LoadingDock";
import { RouteView } from "./pages/RouteView";
import { DriverView } from "./pages/DriverView";

function Nav() {
  return (
    <nav className="app-nav">
      <div className="app-nav-inner">
        <span className="app-nav-brand">📦 Parcel Sweep</span>
        <div className="app-nav-links">
          <NavLink
            to="/"
            end
            className={({ isActive }) => (isActive ? "app-nav-link active" : "app-nav-link")}
          >
            Dashboard
          </NavLink>
          <NavLink
            to="/manifests/new"
            className={({ isActive }) => (isActive ? "app-nav-link active" : "app-nav-link")}
          >
            + Generate Manifest
          </NavLink>
        </div>
      </div>
    </nav>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Driver view is full-screen — no nav */}
        <Route path="/routes/:id/drive" element={<DriverView />} />

        {/* All other pages use the nav */}
        <Route
          path="*"
          element={
            <>
              <Nav />
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/manifests/:id" element={<ManifestPage />} />
                <Route path="/routes/:id/load" element={<LoadingDock />} />
                <Route path="/routes/:id/route" element={<RouteView />} />
              </Routes>
            </>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
