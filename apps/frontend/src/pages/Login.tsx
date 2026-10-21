import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "../api/auth";
import { ApiError } from "../api/client";
import { ThemeToggle } from "../theme/ThemeToggle";
import { BrandMark } from "../components/BrandMark";

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
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-base px-5 py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{ background: "radial-gradient(60rem 30rem at 50% -10%, rgb(var(--c-amber) / 0.12), transparent 70%)" }}
      />
      <div className="absolute right-5 top-5">
        <ThemeToggle />
      </div>
      <main className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandMark size="lg" />
          <p className="mt-4 text-sm text-muted">Temperature control for your fermenters and kegerator.</p>
        </div>
        <form onSubmit={handleSubmit} className="card space-y-5 p-8 shadow-lift">
          <h1 className="font-display text-2xl font-semibold text-fg">Welcome back</h1>
          <div className="space-y-1.5">
            <label htmlFor="username" className="text-sm font-medium text-muted">
              Username
            </label>
            <input
              id="username"
              autoComplete="username"
              className="field"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              required
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="password" className="text-sm font-medium text-muted">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              className="field"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && (
            <p role="alert" className="rounded-xl bg-crit/10 px-3 py-2 text-sm text-crit">
              {error}
            </p>
          )}
          <button type="submit" disabled={submitting} className="btn-primary w-full py-3 text-base">
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </main>
    </div>
  );
}
