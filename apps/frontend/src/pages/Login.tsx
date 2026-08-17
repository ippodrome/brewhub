import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Thermometer } from "lucide-react";
import { login } from "../api/auth";
import { ApiError } from "../api/client";
import { ThemeToggle } from "../theme/ThemeToggle";

export function Login(): JSX.Element {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login({ username, password });
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? "Invalid username or password" : "Could not reach server");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-base">
      <div className="absolute right-6 top-6">
        <ThemeToggle />
      </div>
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-2xl border border-line bg-card p-8"
      >
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber to-heat shadow-inner">
            <Thermometer className="h-5 w-5 text-on-amber" strokeWidth={2.5} />
          </div>
          <h1 className="font-display text-xl text-fg">BrewHub</h1>
        </div>
        <div className="space-y-1">
          <label className="text-sm text-muted">Username</label>
          <input
            className="w-full rounded-xl border border-line-strong bg-surface px-3 py-2 text-fg outline-none focus:border-line-focus"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm text-muted">Password</label>
          <input
            type="password"
            className="w-full rounded-xl border border-line-strong bg-surface px-3 py-2 text-fg outline-none focus:border-line-focus"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-crit">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-xl bg-amber hover:bg-amber-hi px-3 py-2 font-medium text-on-amber disabled:opacity-50"
        >
          {submitting ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </div>
  );
}
