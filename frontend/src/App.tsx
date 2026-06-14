import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import { Dashboard } from "./pages/Dashboard";
import { ManifestPage } from "./pages/ManifestPage";
import { LoadingDock } from "./pages/LoadingDock";
import { RouteView } from "./pages/RouteView";
import { DriverView } from "./pages/DriverView";

function Nav() {
  return (
    <nav style={{
      background: "#004b87",
      color: "#fff",
      padding: ".6rem 1.5rem",
      display: "flex",
      alignItems: "center",
      gap: "1.5rem",
      boxShadow: "0 2px 8px rgba(0,0,0,.25)",
    }}>
      <span style={{ fontWeight: 800, fontSize: "1.1rem", letterSpacing: ".02em" }}>
        📦 Parcel Sweep
      </span>
      <NavLink
        to="/"
        end
        style={({ isActive }) => ({
          color: isActive ? "#fff" : "#90caf9",
          fontWeight: isActive ? 700 : 400,
          fontSize: ".9rem",
          textDecoration: "none",
        })}
      >
        Dashboard
      </NavLink>
      <NavLink
        to="/manifests/new"
        style={({ isActive }) => ({
          color: isActive ? "#fff" : "#90caf9",
          fontWeight: isActive ? 700 : 400,
          fontSize: ".9rem",
          textDecoration: "none",
        })}
      >
        + Generate Manifest
      </NavLink>
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
