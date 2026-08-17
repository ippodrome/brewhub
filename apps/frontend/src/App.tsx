import { Link, NavLink, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { BookOpen, Cpu, LayoutDashboard, LogOut, Settings as SettingsIcon, Thermometer } from "lucide-react";
import { Dashboard } from "./pages/Dashboard";
import { DeviceDisplay } from "./pages/DeviceDisplay";
import { Devices } from "./pages/Devices";
import { Guide } from "./pages/Guide";
import { Login } from "./pages/Login";
import { Settings } from "./pages/Settings";
import { RequireAuth } from "./components/RequireAuth";
import { WsProvider } from "./ws/WsProvider";
import { clearToken, getToken } from "./api/client";
import { ThemeToggle } from "./theme/ThemeToggle";

// Firmware lives inside Settings (see pages/Settings.tsx) rather than as its
// own top-level destination — it's a device-management detail, not
// something reached often enough to earn permanent nav real estate. Guide
// is reference material, not a place you navigate "into" repeatedly like
// the other three, so it sits as an icon button next to the theme toggle
// instead of taking a nav slot.
const NAV_ITEMS = [
  { to: "/", end: true, label: "Dashboard", icon: LayoutDashboard },
  { to: "/devices", end: false, label: "Devices", icon: Cpu },
  { to: "/settings", end: false, label: "Settings", icon: SettingsIcon },
] as const;

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return `flex items-center gap-2 rounded-xl px-3 py-1.5 text-sm font-medium transition-colors ${
    isActive
      ? "bg-tint text-amber"
      : "text-muted hover:text-fg"
  }`;
}

function tabLinkClass({ isActive }: { isActive: boolean }): string {
  return `flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium ${
    isActive ? "text-amber" : "text-muted"
  }`;
}

function Shell(): JSX.Element {
  const { pathname } = useLocation();
  const guideActive = pathname === "/guide";

  return (
    <div className="min-h-screen bg-base">
      <header className="flex items-center justify-between border-b border-line bg-base/80 backdrop-blur-lg sticky top-0 z-40 px-4 sm:px-6 py-3 sm:py-3.5">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-amber to-heat shadow-inner">
              <Thermometer className="h-4.5 w-4.5 text-on-amber" strokeWidth={2.5} />
            </div>
            <span className="font-display text-lg text-fg">BrewHub</span>
          </div>
          {/* Full nav with labels — desktop/tablet only. Mobile gets the
              fixed bottom tab bar below instead, so every destination
              stays visible without needing this row to squeeze into a
              narrow viewport. */}
          <nav className="hidden sm:flex gap-1">
            {NAV_ITEMS.map(({ to, end, label, icon: Icon }) => (
              <NavLink key={to} to={to} end={end} className={navLinkClass}>
                <Icon className="h-4 w-4" strokeWidth={2} />
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/guide"
            aria-label="Guide"
            title="Guide"
            className={`rounded-xl p-1.5 ${
              guideActive
                ? "bg-tint text-amber"
                : "text-dim hover:bg-tint hover:text-fg"
            }`}
          >
            <BookOpen className="h-4 w-4" strokeWidth={2} />
          </Link>
          <ThemeToggle />
          {getToken() && (
            <button
              onClick={() => {
                clearToken();
                window.location.href = "/login";
              }}
              className="flex items-center gap-1.5 text-sm text-dim hover:text-fg"
              aria-label="Sign out"
            >
              <LogOut className="h-3.5 w-3.5" strokeWidth={2} />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          )}
        </div>
      </header>
      <main className="pb-16 sm:pb-0">
        <Outlet />
      </main>
      <nav
        className="sm:hidden fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t border-line bg-card/95 backdrop-blur-lg"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {NAV_ITEMS.map(({ to, end, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={end} className={tabLinkClass}>
            <Icon className="h-5 w-5" strokeWidth={2} />
            {label}
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
          <Route path="/guide" element={<Guide />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
        <Route path="/display/:deviceId" element={<DeviceDisplay />} />
      </Route>
    </Routes>
  );
}
