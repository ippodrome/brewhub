import { Link, NavLink, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { BookOpen, Cpu, LayoutDashboard, Layers, LogOut, Settings as SettingsIcon } from "lucide-react";
import { Dashboard } from "./pages/Dashboard";
import { DeviceDisplay } from "./pages/DeviceDisplay";
import { Devices } from "./pages/Devices";
import { Guide } from "./pages/Guide";
import { Login } from "./pages/Login";
import { Settings } from "./pages/Settings";
import { Templates } from "./pages/Templates";
import { NotFound } from "./pages/NotFound";
import { RequireAuth } from "./components/RequireAuth";
import { WsProvider } from "./ws/WsProvider";
import { clearToken, getToken } from "./api/client";
import { ThemeToggle } from "./theme/ThemeToggle";
import { useLiveTelemetry } from "./ws/useLiveTelemetry";
import { StatusDot } from "./components/StatusDot";
import { summarizeConnection } from "./lib/status";
import { BrandMark } from "./components/BrandMark";

// Firmware lives inside Settings (see pages/Settings.tsx) rather than as its
// own top-level destination — it's a device-management detail. Guide is
// reference material: an icon button on desktop, but a full tab on mobile
// where there is no header room for extra icons.
const NAV_ITEMS = [
  { to: "/", end: true, label: "Dashboard", icon: LayoutDashboard },
  { to: "/devices", end: false, label: "Devices", icon: Cpu },
  { to: "/templates", end: false, label: "Templates", icon: Layers },
  { to: "/settings", end: false, label: "Settings", icon: SettingsIcon },
] as const;

const TAB_ITEMS = [...NAV_ITEMS, { to: "/guide", end: false, label: "Guide", icon: BookOpen }] as const;

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return `flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium ${
    isActive ? "bg-card text-fg shadow-card ring-1 ring-line" : "text-muted hover:text-fg"
  }`;
}

function tabLinkClass({ isActive }: { isActive: boolean }): string {
  return `flex flex-col items-center justify-center gap-1 pb-2 pt-2.5 text-[11px] font-medium ${
    isActive ? "text-amber" : "text-dim"
  }`;
}

/** Server connection — distinct from device health (shown on the dashboard). */
function ConnectionIndicator(): JSX.Element {
  const { connected } = useLiveTelemetry();
  const c = summarizeConnection(connected);
  return (
    <span role="status" title={c.description} className={`pill ${connected ? "text-muted" : "bg-amber/10 text-amber"}`}>
      <StatusDot tone={c.tone} />
      <span className={connected ? "hidden md:inline" : ""}>{connected ? "Live" : c.label}</span>
      <span className="sr-only">{c.description}</span>
    </span>
  );
}

function Shell(): JSX.Element {
  const { pathname } = useLocation();
  const guideActive = pathname === "/guide";

  return (
    <div className="min-h-screen bg-base">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 btn-primary">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-line/70 bg-base/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3 sm:px-8">
          <div className="flex items-center gap-8">
            <Link to="/" aria-label="BrewHub home" className="rounded-xl">
              <BrandMark />
            </Link>
            <nav aria-label="Main" className="hidden gap-1 rounded-full bg-tint/70 p-1 sm:flex">
              {NAV_ITEMS.map(({ to, end, label, icon: Icon }) => (
                <NavLink key={to} to={to} end={end} className={navLinkClass}>
                  <Icon className="h-4 w-4" strokeWidth={1.75} />
                  {label}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <ConnectionIndicator />
            <Link
              to="/guide"
              aria-label="Guide"
              title="Guide"
              aria-current={guideActive ? "page" : undefined}
              className={`icon-btn hidden sm:inline-flex ${guideActive ? "bg-tint text-amber" : ""}`}
            >
              <BookOpen className="h-4 w-4" strokeWidth={1.75} />
            </Link>
            <ThemeToggle />
            {getToken() && (
              <button
                onClick={() => {
                  clearToken();
                  window.location.href = "/login";
                }}
                className="icon-btn"
                aria-label="Sign out"
                title="Sign out"
              >
                <LogOut className="h-4 w-4" strokeWidth={1.75} />
              </button>
            )}
          </div>
        </div>
      </header>
      <main id="main" className="pb-24 sm:pb-8">
        <Outlet />
      </main>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-card/90 backdrop-blur-xl sm:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {TAB_ITEMS.map(({ to, end, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={end} className={tabLinkClass}>
            {({ isActive }) => (
              <>
                <span className={`flex h-7 w-12 items-center justify-center rounded-full ${isActive ? "bg-amber/10" : ""}`}>
                  <Icon className="h-5 w-5" strokeWidth={isActive ? 2 : 1.75} />
                </span>
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

// A layout route: RequireAuth/WsProvider mount ONCE and stay mounted across
// navigation (only the <Outlet/> content swaps) — critical for WsProvider
// specifically, since it owns the single WebSocket connection. Nesting it
// per-route (as a wrapper around each page element) instead would
// unmount/remount it, and therefore drop and reopen the socket, on every
// navigation.
//
// Shell sits one level further in, as its own layout route, so the display
// pages can share this WebSocket while rendering none of the app chrome —
// they are meant to be left open on a screen mounted next to the equipment,
// where a header and a tab bar are wasted space and an invitation to a
// mistaken tap.
function AuthenticatedLayout(): JSX.Element {
  return (
    <RequireAuth>
      <WsProvider>
        <Outlet />
      </WsProvider>
    </RequireAuth>
  );
}

export function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<AuthenticatedLayout />}>
        <Route element={<Shell />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/devices" element={<Devices />} />
          <Route path="/templates" element={<Templates />} />
          <Route path="/guide" element={<Guide />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<NotFound />} />
        </Route>
        <Route path="/display/:deviceId" element={<DeviceDisplay />} />

      </Route>
    </Routes>
  );
}
