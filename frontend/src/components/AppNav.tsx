import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { ThemeSelector } from "./ThemeSelector";

const NAV_ITEMS: { to: string; end?: boolean; label: string }[] = [
  { to: "/", end: true, label: "Dashboard" },
  { to: "/sunday", label: "Sunday Hub" },
  { to: "/manifests/new", label: "Manifests" },
  { to: "/admin", label: "Routes & Drivers" },
  { to: "/quick-route", label: "Quick Route" },
];

export function AppNav() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  return (
    <nav className="app-nav">
      <div className="app-nav-inner">
        <Link to="/" className="app-nav-brand" aria-label="Parcel Sweep home">
          <span aria-hidden="true">📦</span> Parcel Sweep
        </Link>

        <button
          type="button"
          className={`app-nav-toggle${menuOpen ? " is-open" : ""}`}
          aria-expanded={menuOpen}
          aria-controls="app-nav-panel"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span className="app-nav-toggle__bars" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="sr-only">{menuOpen ? "Close menu" : "Open menu"}</span>
        </button>

        <div
          id="app-nav-panel"
          className={`app-nav-panel${menuOpen ? " is-open" : ""}`}
        >
          <div className="app-nav-panel__inner">
            <div className="app-nav-links">
              {NAV_ITEMS.map(({ to, end, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    isActive ? "app-nav-link active" : "app-nav-link"
                  }
                >
                  {label}
                </NavLink>
              ))}
            </div>
            <ThemeSelector variant="compact" className="app-nav-theme" />
          </div>
        </div>
      </div>
    </nav>
  );
}
