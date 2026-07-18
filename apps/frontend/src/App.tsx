import { NavLink, Outlet, Route, Routes } from "react-router-dom";
import { Dashboard } from "./pages/Dashboard";
import { Devices } from "./pages/Devices";
import { Firmware } from "./pages/Firmware";
import { Login } from "./pages/Login";
import { Settings } from "./pages/Settings";
import { RequireAuth } from "./components/RequireAuth";
import { WsProvider } from "./ws/WsProvider";
import { clearToken, getToken } from "./api/client";
import { ThemeToggle } from "./theme/ThemeToggle";

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
    isActive ? "bg-neutral-200 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100" : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
  }`;
}

function Shell(): JSX.Element {
  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <header className="flex items-center justify-between border-b border-neutral-200 dark:border-neutral-800 px-6 py-4">
        <div className="flex items-center gap-6">
          <span className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">BrewHub</span>
          <nav className="flex gap-2">
            <NavLink to="/" end className={navLinkClass}>
              Dashboard
            </NavLink>
            <NavLink to="/devices" className={navLinkClass}>
              Devices
            </NavLink>
            <NavLink to="/firmware" className={navLinkClass}>
              Firmware
            </NavLink>
            <NavLink to="/settings" className={navLinkClass}>
              Settings
            </NavLink>
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
              className="text-sm text-neutral-600 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300"
            >
              Sign out
            </button>
          )}
        </div>
      </header>
      <main>
        <Outlet />
      </main>
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
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
