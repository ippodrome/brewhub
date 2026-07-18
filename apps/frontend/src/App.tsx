import { NavLink, Outlet, Route, Routes } from "react-router-dom";
import { BookOpen, Cpu, LayoutDashboard, LogOut, Settings as SettingsIcon, Thermometer } from "lucide-react";
import { Dashboard } from "./pages/Dashboard";
import { Devices } from "./pages/Devices";
import { Firmware } from "./pages/Firmware";
import { Guide } from "./pages/Guide";
import { Login } from "./pages/Login";
import { Settings } from "./pages/Settings";
import { RequireAuth } from "./components/RequireAuth";
import { WsProvider } from "./ws/WsProvider";
import { clearToken, getToken } from "./api/client";
import { ThemeToggle } from "./theme/ThemeToggle";

const NAV_ITEMS = [
  { to: "/", end: true, label: "Dashboard", icon: LayoutDashboard },
  { to: "/devices", end: false, label: "Devices", icon: Cpu },
  { to: "/firmware", end: false, label: "Firmware", icon: Thermometer },
  { to: "/guide", end: false, label: "Guide", icon: BookOpen },
  { to: "/settings", end: false, label: "Settings", icon: SettingsIcon },
] as const;

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return `flex items-center gap-2 rounded-xl px-3 py-1.5 text-sm font-medium transition-colors ${
    isActive
      ? "bg-neutral-200 dark:bg-neutral-800 text-amber-600 dark:text-amber-400"
      : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
  }`;
}

function tabLinkClass({ isActive }: { isActive: boolean }): string {
  return `flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium ${
    isActive ? "text-amber-600 dark:text-amber-400" : "text-neutral-500 dark:text-neutral-400"
  }`;
}

function Shell(): JSX.Element {
  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <header className="flex items-center justify-between border-b border-neutral-200 dark:border-neutral-800 bg-white/80 dark:bg-neutral-950/80 backdrop-blur-lg sticky top-0 z-40 px-4 sm:px-6 py-3 sm:py-3.5">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-inner">
              <Thermometer className="h-4.5 w-4.5 text-white" strokeWidth={2.5} />
            </div>
            <span className="font-display text-lg text-neutral-900 dark:text-neutral-100">BrewHub</span>
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
          <ThemeToggle />
          {getToken() && (
            <button
              onClick={() => {
                clearToken();
                window.location.href = "/login";
              }}
              className="flex items-center gap-1.5 text-sm text-neutral-600 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300"
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
        className="sm:hidden fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-neutral-200 dark:border-neutral-800 bg-white/95 dark:bg-neutral-950/95 backdrop-blur-lg"
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

// A layout route: RequireAuth/WsProvider/Shell mount ONCE and stay mounted
// across navigation between "/" and "/devices" (only the <Outlet/> content
// swaps) — critical for WsProvider specifically, since it owns the single
// WebSocket connection. Nesting it per-route (as a wrapper around each
// page element) instead would unmount/remount it, and therefore drop and
// reopen the socket, on every navigation.
function AuthenticatedLayout(): JSX.Element {
  return (
    <RequireAuth>
      <WsProvider>
        <Shell />
      </WsProvider>
    </RequireAuth>
  );
}

export function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<AuthenticatedLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/devices" element={<Devices />} />
        <Route path="/firmware" element={<Firmware />} />
        <Route path="/guide" element={<Guide />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
