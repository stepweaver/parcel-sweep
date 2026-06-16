import { BrowserRouter, Routes, Route, NavLink, Link } from "react-router-dom";
import { AppFooter } from "./components/AppFooter";
import { ThemeSelector } from "./components/ThemeSelector";
import { ThemeProvider } from "./context/ThemeProvider";
import { Dashboard } from "./pages/Dashboard";
import { Admin } from "./pages/Admin";
import { SundayDashboard } from "./pages/SundayDashboard";
import { ManifestPage } from "./pages/ManifestPage";
import { LoadingDock } from "./pages/LoadingDock";
import { RouteView } from "./pages/RouteView";
import { DriverView } from "./pages/DriverView";

function Nav() {
  return (
    <nav className="app-nav">
      <div className="app-nav-inner">
        <Link to="/" className="app-nav-brand" aria-label="Parcel Sweep home">
          <span aria-hidden="true">📦</span> Parcel Sweep
        </Link>
        <div className="app-nav-links">
          <NavLink
            to="/"
            end
            className={({ isActive }) => (isActive ? "app-nav-link active" : "app-nav-link")}
          >
            Dashboard
          </NavLink>
          <NavLink
            to="/sunday"
            className={({ isActive }) => (isActive ? "app-nav-link active" : "app-nav-link")}
          >
            Sunday Hub
          </NavLink>
          <NavLink
            to="/manifests/new"
            className={({ isActive }) => (isActive ? "app-nav-link active" : "app-nav-link")}
          >
            Manifests
          </NavLink>
          <NavLink
            to="/admin"
            className={({ isActive }) => (isActive ? "app-nav-link active" : "app-nav-link")}
          >
            Routes &amp; Drivers
          </NavLink>
        </div>
        <ThemeSelector variant="compact" className="app-nav-theme" />
      </div>
    </nav>
  );
}

export default function App() {
  return (
    <ThemeProvider>
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
                <Route path="/sunday" element={<SundayDashboard />} />
                <Route path="/admin" element={<Admin />} />
                <Route path="/manifests/:id" element={<ManifestPage />} />
                <Route path="/routes/:id/load" element={<LoadingDock />} />
                <Route path="/routes/:id/route" element={<RouteView />} />
              </Routes>
              <AppFooter />
            </>
          }
        />
      </Routes>
    </BrowserRouter>
    </ThemeProvider>
  );
}
