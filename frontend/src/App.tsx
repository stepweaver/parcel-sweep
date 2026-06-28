import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppFooter } from "./components/AppFooter";
import { AppNav } from "./components/AppNav";
import { ThemeProvider } from "./context/ThemeProvider";
import { Dashboard } from "./pages/Dashboard";
import { Admin } from "./pages/Admin";
import { SundayDashboard } from "./pages/SundayDashboard";
import { ManifestPage } from "./pages/ManifestPage";
import { LoadingDock } from "./pages/LoadingDock";
import { RouteView } from "./pages/RouteView";
import { DriverView } from "./pages/DriverView";
import { QuickRoutePage } from "./pages/QuickRoutePage";

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
              <AppNav />
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/sunday" element={<SundayDashboard />} />
                <Route path="/admin" element={<Admin />} />
                <Route path="/manifests/:id" element={<ManifestPage />} />
                <Route path="/routes/:id/load" element={<LoadingDock />} />
                <Route path="/routes/:id/route" element={<RouteView />} />
                <Route path="/quick-route" element={<QuickRoutePage />} />
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
