import { NavLink, Route, Routes } from "react-router-dom";
import { Dashboard } from "./pages/Dashboard";
import { Devices } from "./pages/Devices";
import { Login } from "./pages/Login";
import { RequireAuth } from "./components/RequireAuth";
import { WsProvider } from "./ws/WsProvider";
import { clearToken, getToken } from "./api/client";

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
    isActive ? "bg-neutral-800 text-neutral-100" : "text-neutral-400 hover:text-neutral-200"
  }`;
}

function Shell({ children }: { children: JSX.Element }): JSX.Element {
  return (
    <WsProvider>
      <div className="min-h-screen bg-neutral-950">
        <header className="flex items-center justify-between border-b border-neutral-800 px-6 py-4">
          <div className="flex items-center gap-6">
            <span className="text-lg font-semibold text-neutral-100">BrewHub</span>
            <nav className="flex gap-2">
              <NavLink to="/" end className={navLinkClass}>
                Dashboard
              </NavLink>
              <NavLink to="/devices" className={navLinkClass}>
                Devices
              </NavLink>
            </nav>
          </div>
          {getToken() && (
            <button
              onClick={() => {
                clearToken();
                window.location.href = "/login";
              }}
              className="text-sm text-neutral-500 hover:text-neutral-300"
            >
              Sign out
            </button>
          )}
        </header>
        <main>{children}</main>
      </div>
    </WsProvider>
  );
}

export function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Shell>
              <Dashboard />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/devices"
        element={
          <RequireAuth>
            <Shell>
              <Devices />
            </Shell>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
